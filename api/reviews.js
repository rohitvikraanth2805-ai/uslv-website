import {
  createHash,
  createHmac,
  randomUUID,
  randomBytes,
  scrypt,
  timingSafeEqual
} from "node:crypto";
import { promisify } from "node:util";

const derive = promisify(scrypt);

const REVIEW_KEY = "uslv:counselling-reviews:v1";
const PASSWORD_KEY = "uslv:reviews-admin-password:v2";
const PAGE_SIZE = 10;

const RATINGS = [
  "preExperience",
  "testClarity",
  "oneToOne",
  "roadmapClarity",
  "rating"
];

// Email addresses and password information are never returned publicly.
const PUBLIC_FIELDS = [
  "id",
  "schemaVersion",
  "createdAt",
  "name",
  "category",
  "sessionDate",
  ...RATINGS,
  "confusionBefore",
  "clarityAfter",
  "recommendedBy",
  "recommend",

  // Support existing reviews saved using the older form.
  "counsellor",
  "review",
  "helpful",
  "professionalism",
  "improvements"
];

const LIMIT = `
  local n = redis.call("INCR", KEYS[1])

  if n == 1 then
    redis.call("EXPIRE", KEYS[1], ARGV[1])
  end

  return n
`;

const CHANGE_PASSWORD = `
  if redis.call("GET", KEYS[1]) ~= ARGV[1] then
    return 0
  end

  redis.call("SET", KEYS[1], ARGV[2])
  return 1
`;

const SAVE_REVIEW = `
  if redis.call("GET", KEYS[4]) ~= ARGV[3] then
    return 4
  end

  local previous = redis.call("GET", KEYS[3])

  if previous then
    if previous == ARGV[2] then
      return 2
    end

    return 3
  end

  local count = tonumber(redis.call("GET", KEYS[2]) or "0")

  if count >= 5 then
    return 0
  end

  local updated = redis.call("INCR", KEYS[2])

  if updated == 1 then
    redis.call("EXPIRE", KEYS[2], 3600)
  end

  redis.call("LPUSH", KEYS[1], ARGV[1])
  redis.call("SET", KEYS[3], ARGV[2], "EX", 86400)

  return 1
`;

function fail(message, status = 400) {
  throw Object.assign(new Error(message), { status });
}

async function redis(command) {
  const response = await fetch(
    process.env.UPSTASH_REDIS_REST_URL.replace(/\/+$/, ""),
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(command),
      signal: AbortSignal.timeout(8000)
    }
  );

  if (!response.ok) {
    throw new Error("Database request failed.");
  }

  const data = await response.json();

  if (data.error) {
    throw new Error("Database command failed.");
  }

  return data.result;
}

async function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const key = await derive(password, salt, 64);

  return `${salt}:${key.toString("hex")}`;
}

async function matches(password, stored) {
  if (!/^[a-f0-9]{32}:[a-f0-9]{128}$/.test(stored)) {
    throw new Error("Invalid password record.");
  }

  const [salt, hash] = stored.split(":");
  const candidate = await derive(password, salt, 64);

  return timingSafeEqual(candidate, Buffer.from(hash, "hex"));
}

async function authenticate(req) {
  const ip = String(
    req.headers["x-forwarded-for"] ||
    req.socket?.remoteAddress ||
    "unknown"
  ).split(",")[0].trim();

  const visitor = createHmac(
    "sha256",
    process.env.UPSTASH_REDIS_REST_TOKEN
  ).update(ip).digest("hex");

  const attempts = Number(
    await redis([
      "EVAL",
      LIMIT,
      1,
      `uslv:review-auth:v2:${visitor}`,
      900
    ])
  );

  if (attempts > 30) {
    fail("Too many admin requests. Please wait 15 minutes.", 429);
  }

  const header = String(req.headers.authorization || "");

  const password = header.startsWith("Bearer ")
    ? header.slice(7)
    : "";

  if (password.length < 8 || password.length > 64) {
    fail("Incorrect admin password.", 401);
  }

  let stored = await redis(["GET", PASSWORD_KEY]);

  if (!stored) {
    const initial = process.env.USLV_ADMIN_INITIAL_PASSWORD || "";

    if (initial.length < 8 || initial.length > 64) {
      fail("Set USLV_ADMIN_INITIAL_PASSWORD in Vercel first.", 503);
    }

    await redis([
      "SET",
      PASSWORD_KEY,
      await hashPassword(initial),
      "NX"
    ]);

    stored = await redis(["GET", PASSWORD_KEY]);
  }

  if (!(await matches(password, stored))) {
    fail("Incorrect admin password.", 401);
  }

  return { stored, visitor };
}

function validate(body) {
  const text = (key, max, required = true) => {
    const value = body[key];

    if (typeof value !== "string") {
      fail(`Please check ${key}.`);
    }

    const result = value.trim();

    if ((required && !result) || result.length > max) {
      fail(`Please check ${key}.`);
    }

    return result;
  };

  const review = {
    schemaVersion: 2,
    name: text("name", 80),
    email: text("email", 254),
    category: text("category", 100),
    sessionDate: text("sessionDate", 10),
    confusionBefore: text("confusionBefore", 5000),
    clarityAfter: text("clarityAfter", 5000),
    recommendedBy: text("recommendedBy", 500),
    recommend: text("recommend", 500)
  };

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(review.email)) {
    fail("Enter a valid email address.");
  }

  for (const field of RATINGS) {
    if (
      !Number.isInteger(body[field]) ||
      body[field] < 1 ||
      body[field] > 5
    ) {
      fail("Select all five ratings from 1 to 5.");
    }

    review[field] = body[field];
  }

  const date = new Date(`${review.sessionDate}T00:00:00Z`);

  const latest = new Date(
    Date.now() + 14 * 60 * 60 * 1000
  ).toISOString().slice(0, 10);

  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(review.sessionDate) ||
    Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, 10) !== review.sessionDate ||
    review.sessionDate > latest
  ) {
    fail("Enter a valid past or current counselling date.");
  }

  if (body.consent !== true) {
    fail("Confirm permission to publish this feedback.");
  }

  if (
    typeof body.requestId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      body.requestId
    )
  ) {
    fail("Refresh the page and try again.");
  }

  return review;
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");

  if (!["GET", "POST", "PATCH"].includes(req.method)) {
    res.setHeader("Allow", "GET, POST, PATCH");

    return res.status(405).json({
      error: "Method not allowed."
    });
  }

  if (
    !process.env.UPSTASH_REDIS_REST_URL ||
    !process.env.UPSTASH_REDIS_REST_TOKEN
  ) {
    return res.status(503).json({
      error: "Review database is not configured."
    });
  }

  try {
    // Public: load reviews without exposing email addresses.
    if (req.method === "GET") {
      const page = new URL(
        req.url,
        "http://localhost"
      ).searchParams.get("page") || "0";

      if (!/^\d{1,7}$/.test(page)) {
        fail("Invalid review page.");
      }

      const start = Number(page) * PAGE_SIZE;

      const rows = await redis([
        "LRANGE",
        REVIEW_KEY,
        start,
        start + PAGE_SIZE
      ]);

      const reviews = rows.slice(0, PAGE_SIZE).map(row => {
        const record = typeof row === "string"
          ? JSON.parse(row)
          : row;

        return Object.fromEntries(
          PUBLIC_FIELDS
            .filter(key => Object.hasOwn(record, key))
            .map(key => [key, record[key]])
        );
      });

      return res.status(200).json({
        reviews,
        hasMore: rows.length > PAGE_SIZE
      });
    }

    if (
      !String(req.headers["content-type"] || "")
        .toLowerCase()
        .startsWith("application/json")
    ) {
      fail("Use the admin form to submit data.", 415);
    }

    let body;

    try {
      body = typeof req.body === "string"
        ? JSON.parse(req.body)
        : req.body;
    } catch {
      fail("Invalid JSON.");
    }

    if (!body || typeof body !== "object" || Array.isArray(body)) {
      fail("Invalid request.");
    }

    if (Buffer.byteLength(JSON.stringify(body)) > 50000) {
      fail("Request is too large.", 413);
    }

    // Both publishing and changing passwords require authentication.
    const auth = await authenticate(req);

    if (req.method === "PATCH") {
      const next = body.newPassword;

      if (
        typeof next !== "string" ||
        next.length < 8 ||
        next.length > 64 ||
        !/^[\x21-\x7E]+$/.test(next)
      ) {
        fail(
          "Use 8–64 characters without spaces; letters, numbers and symbols are allowed."
        );
      }

      const result = Number(
        await redis([
          "EVAL",
          CHANGE_PASSWORD,
          1,
          PASSWORD_KEY,
          auth.stored,
          await hashPassword(next)
        ])
      );

      if (result !== 1) {
        fail(
          "Password changed in another request. Use the latest password.",
          409
        );
      }

      return res.status(200).json({ success: true });
    }

    const review = validate(body);

    const fingerprint = createHash("sha256")
      .update(JSON.stringify(review))
      .digest("hex");

    const record = {
      id: randomUUID(),
      ...review,
      createdAt: new Date().toISOString()
    };

    const result = Number(
      await redis([
        "EVAL",
        SAVE_REVIEW,
        4,
        REVIEW_KEY,
        `uslv:review-limit:${auth.visitor}`,
        `uslv:review-request:v2:${body.requestId}`,
        PASSWORD_KEY,
        JSON.stringify(record),
        fingerprint,
        auth.stored
      ])
    );

    if (result === 0) {
      fail(
        "Limit of five reviews per hour reached. Please try later.",
        429
      );
    }

    if (result === 3) {
      fail(
        "This request was already used for different feedback. Reload the page.",
        409
      );
    }

    if (result === 4) {
      fail("Password changed. Enter the latest password.", 401);
    }

    if (![1, 2].includes(result)) {
      throw new Error("Unexpected save result.");
    }

    return res.status(result === 2 ? 200 : 201).json({
      success: true
    });
  } catch (error) {
    return res.status(error.status || 503).json({
      error: error.status
        ? error.message
        : "The operation could not be confirmed. Retry with the same details."
    });
  }
}
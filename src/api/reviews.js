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

const FIELDS = [
  "name",
  "category",
  "sessionDate",
  ...RATINGS,
  "confusionBefore",
  "clarityAfter",
  "recommendedBy",
  "recommend"
];

const LEGACY = [
  "counsellor",
  "review",
  "helpful",
  "professionalism",
  "improvements"
];

const LIMIT = `
  local n = redis.call('INCR', KEYS[1])

  if n == 1 then
    redis.call('EXPIRE', KEYS[1], ARGV[1])
  end

  return n
`;

const CHANGE_PASSWORD = `
  if redis.call('GET', KEYS[1]) ~= ARGV[1] then
    return 0
  end

  redis.call('SET', KEYS[1], ARGV[2])
  return 1
`;

const SAVE_REVIEW = `
  if redis.call('GET', KEYS[4]) ~= ARGV[3] then
    return 4
  end

  local previous = redis.call('GET', KEYS[3])

  if previous then
    if previous == ARGV[2] then
      return 2
    end
    return 3
  end

  local count = tonumber(redis.call('GET', KEYS[2]) or '0')

  if count >= 100 then
    return 0
  end

  local updated = redis.call('INCR', KEYS[2])

  if updated == 1 then
    redis.call('EXPIRE', KEYS[2], 3600)
  end

  redis.call('LPUSH', KEYS[1], ARGV[1])
  redis.call('SET', KEYS[3], ARGV[2], 'EX', 86400)

  return 1
`;

// Imported Sheet response IDs are retained to prevent duplicates.
const SAVE_BATCH = `
  if redis.call('GET', KEYS[2]) ~= ARGV[1] then
    return {-1}
  end

  local entries = cjson.decode(ARGV[2])
  local results = {}
  local count = tonumber(redis.call('GET', KEYS[3]) or '0')

  for i, entry in ipairs(entries) do
    local previous = redis.call('GET', KEYS[3 + i])

    if previous then
      if previous == entry.fingerprint then
        results[i] = 2
      else
        results[i] = 3
      end
    elseif count >= 100 then
      results[i] = 0
    else
      redis.call('LPUSH', KEYS[1], entry.record)
      redis.call('SET', KEYS[3 + i], entry.fingerprint)

      count = redis.call('INCR', KEYS[3])

      if count == 1 then
        redis.call('EXPIRE', KEYS[3], 3600)
      end

      results[i] = 1
    end
  end

  return results
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

  return timingSafeEqual(
    await derive(password, salt, 64),
    Buffer.from(hash, "hex")
  );
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
  const requested = body.selectedFields === undefined
    ? FIELDS
    : body.selectedFields;

  if (
    !Array.isArray(requested) ||
    !requested.length ||
    requested.length > FIELDS.length ||
    requested.some(key => !FIELDS.includes(key))
  ) {
    fail("Select at least one valid answer to publish.");
  }

  const selected = FIELDS.filter(key => requested.includes(key));

  const review = {
    schemaVersion: 3,
    selectedFields: selected
  };

  const limits = {
    name: 80,
    category: 100,
    sessionDate: 10,
    confusionBefore: 5000,
    clarityAfter: 5000,
    recommendedBy: 500,
    recommend: 500
  };

  // Only selected answers are validated and saved.
  for (const key of selected) {
    if (RATINGS.includes(key)) {
      if (
        !Number.isInteger(body[key]) ||
        body[key] < 1 ||
        body[key] > 5
      ) {
        fail(`Choose a rating from 1 to 5 for ${key}.`);
      }

      review[key] = body[key];
    } else {
      if (
        typeof body[key] !== "string" ||
        !body[key].trim() ||
        body[key].trim().length > limits[key]
      ) {
        fail(`Please check ${key}.`);
      }

      review[key] = body[key].trim();
    }
  }

  if (selected.includes("sessionDate")) {
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
  }

  if (body.consent !== true) {
    fail("Confirm permission to publish the selected answers.");
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

function publicReview(record) {
  const fields = record.schemaVersion === 3
    ? FIELDS.filter(key =>
        Array.isArray(record.selectedFields) &&
        record.selectedFields.includes(key)
      )
    : [...FIELDS, ...LEGACY];

  const result = {};

  for (const key of ["id", "schemaVersion", "createdAt", ...fields]) {
    if (Object.hasOwn(record, key)) {
      result[key] = record[key];
    }
  }

  if (record.schemaVersion === 3) {
    result.selectedFields = fields;
  }

  return result;
}

async function publishBatch(body, auth, res) {
  if (
    !Array.isArray(body.reviews) ||
    !body.reviews.length ||
    body.reviews.length > 20
  ) {
    fail("Select between 1 and 20 reviews.");
  }

  const ids = new Set();

  const entries = body.reviews.map((item, index) => {
    if (
      !item ||
      typeof item !== "object" ||
      Array.isArray(item) ||
      typeof item.sourceId !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        item.sourceId
      )
    ) {
      fail(`Review ${index + 1}: invalid Sheet response ID. Import again.`);
    }

    const id = item.sourceId.toLowerCase();

    if (ids.has(id)) {
      fail("The batch contains a duplicate response.");
    }

    ids.add(id);

    let review;

    try {
      review = validate({ ...item, requestId: id });
    } catch (error) {
      fail(`Review ${index + 1}: ${error.message}`);
    }

    return {
      sourceId: id,
      fingerprint: createHash("sha256")
        .update(JSON.stringify(review))
        .digest("hex"),
      record: JSON.stringify({
        id: randomUUID(),
        ...review,
        createdAt: new Date().toISOString()
      })
    };
  });

  const result = await redis([
    "EVAL",
    SAVE_BATCH,
    3 + entries.length,
    REVIEW_KEY,
    PASSWORD_KEY,
    `uslv:review-limit:${auth.visitor}`,
    ...entries.map(entry => `uslv:review-source:v1:${entry.sourceId}`),
    auth.stored,
    JSON.stringify(entries)
  ]);

  if (Array.isArray(result) && Number(result[0]) === -1) {
    fail("Password changed. Enter the latest password.", 401);
  }

  if (
    !Array.isArray(result) ||
    result.length !== entries.length ||
    result.some(code => ![0, 1, 2, 3].includes(Number(code)))
  ) {
    throw new Error("Unexpected batch result.");
  }

  return res.status(200).json({
    success: true,
    results: entries.map((entry, index) => ({
      sourceId: entry.sourceId,
      status: [
        "limited",
        "published",
        "alreadyPublished",
        "conflict"
      ][Number(result[index])]
    }))
  });
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
    if (req.method === "GET") {
      const page = new URL(
        req.url,
        "http://localhost"
      ).searchParams.get("page") || "0";

      if (!/^\d{1,7}$/.test(page)) {
        fail("Invalid review page.");
      }

      const start = Number(page) * PAGE_SIZE;

      // Read one snapshot so the average includes every published review.
      const rows = await redis(["LRANGE", REVIEW_KEY, 0, -1]);

      const reviews = rows.map(row => publicReview(
        typeof row === "string" ? JSON.parse(row) : row
      ));

      let total = 0;
      let ratedCount = 0;

      for (const review of reviews) {
        const selected =
          Number(review.schemaVersion) < 3 ||
          !review.schemaVersion ||
          (
            Array.isArray(review.selectedFields) &&
            review.selectedFields.includes("rating")
          );

        const rating = Number(review.rating);

        if (
          selected &&
          Number.isInteger(rating) &&
          rating >= 1 &&
          rating <= 5
        ) {
          total += rating;
          ratedCount += 1;
        }
      }

      return res.status(200).json({
        reviews: reviews.slice(start, start + PAGE_SIZE),
        hasMore: start + PAGE_SIZE < reviews.length,
        summary: {
          ratedCount,
          average: ratedCount ? total / ratedCount : null
        }
      });
    }

    if (
      !String(req.headers["content-type"] || "")
        .toLowerCase()
        .startsWith("application/json")
    ) {
      fail("Use the admin form.", 415);
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

    if (Buffer.byteLength(JSON.stringify(body)) > 1000000) {
      fail("Request is too large.", 413);
    }

    const auth = await authenticate(req);

    if (req.method === "PATCH") {
      const next = body.newPassword;

      if (
        typeof next !== "string" ||
        !/^[\x21-\x7E]{8,64}$/.test(next)
      ) {
        fail("Use 8–64 characters without spaces.");
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

    if (Object.hasOwn(body, "reviews")) {
      return await publishBatch(body, auth, res);
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
      fail("Limit of 100 reviews per hour reached. Please try later.", 429);
    }

    if (result === 3) {
      fail(
        "This request was already used for different feedback. Reload before a new submission.",
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
        : "Operation not confirmed. Retry with the same details."
    });
  }
}
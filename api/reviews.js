import { createHash, createHmac, randomUUID } from "node:crypto";

const REVIEW_KEY = "uslv:counselling-reviews:v1";
const PAGE_SIZE = 10;

// Saves a review atomically, limits repeated submissions,
// and prevents duplicate reviews when the same request is retried.
const SAVE_REVIEW = `
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

async function redis(command) {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) {
    throw new Error("Review database is not configured.");
  }

  const response = await fetch(url.replace(/\/+$/, ""), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(command),
    signal: AbortSignal.timeout(8000)
  });

  if (!response.ok) {
    throw new Error("Review database request failed.");
  }

  const data = await response.json();

  if (data.error) {
    throw new Error("Review database command failed.");
  }

  return data.result;
}

function validateReview(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("Invalid review.");
  }

  function text(key, minimum, maximum) {
    const value = body[key];

    if (typeof value !== "string") {
      throw new Error(`Please check the ${key} field.`);
    }

    const result = value.trim();

    if (result.length < minimum || result.length > maximum) {
      throw new Error(`Please check the ${key} field.`);
    }

    return result;
  }

  const name = text("name", 2, 80);
  const counsellor = text("counsellor", 2, 100);
  const review = text("review", 10, 1500);
  const improvements = text("improvements", 0, 1000);
  const sessionDate = text("sessionDate", 10, 10);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(sessionDate)) {
    throw new Error("Please enter a valid counselling date.");
  }

  const parsedDate = new Date(`${sessionDate}T00:00:00Z`);

  if (
    Number.isNaN(parsedDate.getTime()) ||
    parsedDate.toISOString().slice(0, 10) !== sessionDate
  ) {
    throw new Error("Please enter a valid counselling date.");
  }

  // Allow the current calendar date anywhere in the world.
  const latestDate = new Date(
    Date.now() + 14 * 60 * 60 * 1000
  ).toISOString().slice(0, 10);

  if (sessionDate > latestDate) {
    throw new Error("The counselling date cannot be in the future.");
  }

  if (
    !Number.isInteger(body.rating) ||
    body.rating < 1 ||
    body.rating > 5
  ) {
    throw new Error("Please select a rating.");
  }

  if (!["Yes", "Partly", "No"].includes(body.helpful)) {
    throw new Error("Please answer whether the session was helpful.");
  }

  if (
    !["Excellent", "Good", "Fair", "Poor"].includes(body.professionalism)
  ) {
    throw new Error("Please select a professionalism rating.");
  }

  if (body.consent !== true) {
    throw new Error("Please agree to publish your review.");
  }

  if (
    typeof body.requestId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      body.requestId
    )
  ) {
    throw new Error("Please refresh the page and try again.");
  }

  return {
    name,
    counsellor,
    sessionDate,
    rating: body.rating,
    helpful: body.helpful,
    professionalism: body.professionalism,
    review,
    improvements
  };
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");

  if (!["GET", "POST"].includes(req.method)) {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({
      error: "Method not allowed."
    });
  }

  if (
    !process.env.UPSTASH_REDIS_REST_URL ||
    !process.env.UPSTASH_REDIS_REST_TOKEN
  ) {
    return res.status(503).json({
      error: "The review database has not been connected yet."
    });
  }

  if (req.method === "GET") {
    const url = new URL(req.url, "http://localhost");
    const rawPage = url.searchParams.get("page") || "0";

    if (!/^\d{1,7}$/.test(rawPage)) {
      return res.status(400).json({
        error: "Invalid review page."
      });
    }

    const page = Number(rawPage);
    const start = page * PAGE_SIZE;

    try {
      // Fetch one extra item to determine whether another page exists.
      const rows = await redis([
        "LRANGE",
        REVIEW_KEY,
        start,
        start + PAGE_SIZE
      ]);

      return res.status(200).json({
        reviews: rows.slice(0, PAGE_SIZE).map((row) => JSON.parse(row)),
        hasMore: rows.length > PAGE_SIZE
      });
  } catch (error) {
  console.error("Review loading failed:", error);
  return res.status(503).json({
    error: "Reviews could not be loaded. Please try again."
  });
}
  }

  const contentType = String(req.headers["content-type"] || "");

  if (!contentType.toLowerCase().startsWith("application/json")) {
    return res.status(415).json({
      error: "Please submit the review using the website form."
    });
  }

  let body;
  let review;

  try {
    body =
      typeof req.body === "string"
        ? JSON.parse(req.body)
        : req.body;

    if (Buffer.byteLength(JSON.stringify(body) || "") > 20000) {
      return res.status(413).json({
        error: "The review is too long."
      });
    }

    review = validateReview(body);
  } catch (error) {
    return res.status(400).json({
      error:
        error instanceof SyntaxError
          ? "Invalid review data."
          : error.message
    });
  }

  // The IP address itself is not saved with the public review.
  const ip = String(
    req.headers["x-forwarded-for"] ||
    req.socket?.remoteAddress ||
    "unknown"
  ).split(",")[0].trim();

  const visitorKey = createHmac(
    "sha256",
    process.env.UPSTASH_REDIS_REST_TOKEN
  ).update(ip).digest("hex");

  const fingerprint = createHash("sha256")
    .update(JSON.stringify(review))
    .digest("hex");

  const publicReview = {
    id: randomUUID(),
    ...review,
    createdAt: new Date().toISOString()
  };

  try {
    const result = await redis([
      "EVAL",
      SAVE_REVIEW,
      3,
      REVIEW_KEY,
      `uslv:review-limit:${visitorKey}`,
      `uslv:review-request:${body.requestId}`,
      JSON.stringify(publicReview),
      fingerprint
    ]);

    if (result === 0) {
      return res.status(429).json({
        error:
          "Too many reviews from this connection. Please try again later."
      });
    }

    if (result === 3) {
      return res.status(409).json({
        error: "Please refresh the page before submitting another review."
      });
    }

    return res.status(result === 2 ? 200 : 201).json({
      success: true
    });
  } catch {
    return res.status(503).json({
      error:
        "We could not confirm submission. You can retry the same review."
    });
  }
}
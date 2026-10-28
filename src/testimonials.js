(() => {
  "use strict";

  const section = document.getElementById("testimonials");
  if (!section) return;

  section.innerHTML = `
    <div class="container">
      <h2 id="testimonialsTitle">Testimonials</h2>

      <div id="overallRating" class="overall-rating" hidden></div>

      <div class="review-toolbar">
        <div>
          <h3>Customer Reviews</h3>
          <p>Feedback from our counselling clients.</p>
        </div>

        <div class="review-buttons">
          <button
            type="button"
            class="btn btn-small"
            id="refreshReviews"
          >
            Refresh Reviews
          </button>

          <button
            type="button"
            class="btn btn-small"
            id="openReviews"
            aria-haspopup="dialog"
            aria-controls="uslvReviewsPanel"
          >
            Open Reviews
          </button>
        </div>
      </div>

      <p id="reviewsMainStatus" role="status" aria-live="polite"></p>
    </div>
  `;

  const panel = document.createElement("dialog");
  panel.id = "uslvReviewsPanel";
  panel.setAttribute("aria-labelledby", "reviewsPanelTitle");

  panel.innerHTML = `
    <div class="reviews-panel-layout">
      <div class="reviews-panel-header">
        <h2 id="reviewsPanelTitle">Customer Reviews</h2>

        <button
          type="button"
          class="btn btn-small"
          id="closeReviews"
          autofocus
        >
          Close
        </button>
      </div>

      <div class="reviews-panel-body">
        <div id="panelOverallRating" class="overall-rating" hidden></div>

        <p>Feedback from our counselling clients.</p>

        <p
          id="reviewsPanelStatus"
          role="status"
          aria-live="polite"
        ></p>

        <div id="reviewsList" class="review-list"></div>

        <button
          type="button"
          id="loadMoreReviews"
          class="btn btn-small"
          hidden
        >
          Load More Reviews
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(panel);

  const style = document.createElement("style");

  style.textContent = `
    #testimonials [hidden],
    #uslvReviewsPanel [hidden] {
      display: none !important;
    }

    .overall-rating {
      margin: 1rem 0 1.5rem;
    }

    .overall-rating p {
      margin: .35rem 0;
    }

    .overall-rating .average-stars {
      position: relative;
      display: inline-block;
      color: #38bdf8;
      font-size: 2rem;
      line-height: 1.2;
      white-space: nowrap;
      letter-spacing: .08em;
    }

    .overall-rating .average-stars-fill {
      position: absolute;
      inset: 0 auto 0 0;
      overflow: hidden;
      white-space: nowrap;
    }

    #testimonials .review-toolbar {
      display: flex;
      flex-wrap: wrap;
      align-items: flex-start;
      justify-content: space-between;
      gap: 1.5rem;
      margin-top: 1.5rem;
    }

    #testimonials .review-toolbar h3 {
      margin-bottom: 1rem;
    }

    #testimonials .review-buttons {
      display: flex;
      flex-direction: column;
      gap: .75rem;
    }

    #testimonials .review-buttons .btn {
      width: 100%;
      text-align: center;
    }

    #testimonials #reviewsMainStatus {
      margin-top: 1rem;
    }

    #uslvReviewsPanel {
      position: fixed;
      inset: 0 0 0 auto;
      width: min(720px, 100%);
      max-width: 100%;
      height: 100%;
      height: 100dvh;
      max-height: 100%;
      margin: 0;
      padding: 0;
      border: 0;
      border-left: 1px solid var(--line);
      background: var(--bg-alt);
      color: var(--ink);
      font: inherit;
      overflow: hidden;
      box-shadow: -12px 0 40px rgba(11, 47, 48, .18);
    }

    #uslvReviewsPanel::backdrop {
      background: rgba(11, 47, 48, .5);
    }

    #uslvReviewsPanel .reviews-panel-layout {
      display: flex;
      flex-direction: column;
      height: 100%;
    }

    #uslvReviewsPanel .reviews-panel-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
      padding: 1.25rem 1.5rem;
      background: var(--bg);
      border-bottom: 1px solid var(--line);
      flex-shrink: 0;
    }

    #uslvReviewsPanel .reviews-panel-header h2 {
      margin: 0;
      font-size: clamp(1.3rem, 4vw, 1.8rem);
    }

    #uslvReviewsPanel .reviews-panel-header .btn {
      flex-shrink: 0;
    }

    #uslvReviewsPanel .reviews-panel-body {
      flex: 1;
      min-height: 0;
      padding: 1.5rem;
      overflow-y: auto;
      overscroll-behavior: contain;
    }

    #uslvReviewsPanel .review-list {
      display: grid;
      gap: 1.25rem;
    }

    #uslvReviewsPanel .review-heading {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: .75rem;
      margin-bottom: 1rem;
    }

    #uslvReviewsPanel .review-heading h3 {
      margin: 0;
      overflow-wrap: anywhere;
    }

    #uslvReviewsPanel .review-stars {
      color: #38bdf8;
      font-size: 1.2rem;
      white-space: nowrap;
    }

    #uslvReviewsPanel .review-answer {
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }

    #uslvReviewsPanel .review-card p:last-child {
      margin-bottom: 0;
    }

    #uslvReviewsPanel #loadMoreReviews {
      margin-top: 1.5rem;
    }

    @media (max-width: 640px) {
      #uslvReviewsPanel .reviews-panel-header {
        padding: 1rem;
      }

      #uslvReviewsPanel .reviews-panel-body {
        padding: 1rem;
      }

      #uslvReviewsPanel .review-card {
        padding: 1.25rem;
      }
    }
  `;

  document.head.appendChild(style);

  const refreshButton = section.querySelector("#refreshReviews");
  const openButton = section.querySelector("#openReviews");
  const mainStatus = section.querySelector("#reviewsMainStatus");

  const closeButton = panel.querySelector("#closeReviews");
  const panelStatus = panel.querySelector("#reviewsPanelStatus");
  const list = panel.querySelector("#reviewsList");
  const moreButton = panel.querySelector("#loadMoreReviews");

  const summaries = [
    section.querySelector("#overallRating"),
    panel.querySelector("#panelOverallRating")
  ];

  function updateSummary(summary) {
    const count = summary?.ratedCount;
    const average = summary?.average;

    const valid =
      Number.isInteger(count) &&
      count > 0 &&
      typeof average === "number" &&
      Number.isFinite(average) &&
      average >= 1 &&
      average <= 5;

    for (const box of summaries) {
      box.replaceChildren();
      box.hidden = !valid;

      if (!valid) continue;

      const title = document.createElement("p");
      const strong = document.createElement("strong");
      strong.textContent = "Overall Rating";
      title.appendChild(strong);

      const stars = document.createElement("span");
      stars.className = "average-stars";
      stars.setAttribute("aria-hidden", "true");
      stars.textContent = "☆☆☆☆☆";

      const fill = document.createElement("span");
      fill.className = "average-stars-fill";
      fill.textContent = "★★★★★";
      fill.style.width = `${average / 5 * 100}%`;

      stars.appendChild(fill);

      const description = document.createElement("p");
      description.textContent =
        `${average.toFixed(1)} out of 5 · Based on ${count} ${
          count === 1 ? "rated review" : "rated reviews"
        }`;

      box.append(title, stars, description);
    }
  }

  let page = 0;
  let loading = false;
  let loaded = false;
  let previousOverflow = "";

  // Only show fields selected for publication by the administrator.
  function isIncluded(review, key) {
    const value = review[key];

    if (value === undefined || value === null || value === "") {
      return false;
    }

    if (Number(review.schemaVersion) >= 3) {
      return (
        Array.isArray(review.selectedFields) &&
        review.selectedFields.includes(key)
      );
    }

    // Older published reviews do not have selectedFields.
    return true;
  }

  function formatDate(value) {
    const text = String(value);

    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
      return text;
    }

    const date = new Date(`${text}T12:00:00`);

    if (Number.isNaN(date.getTime())) {
      return text;
    }

    return date.toLocaleDateString("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric"
    });
  }

  function appendAnswer(card, label, value) {
    const paragraph = document.createElement("p");
    paragraph.className = "review-answer";

    const heading = document.createElement("strong");
    heading.textContent = `${label}: `;

    paragraph.append(
      heading,
      document.createTextNode(String(value))
    );

    card.appendChild(paragraph);
  }

  function showReview(review) {
    const card = document.createElement("article");
    card.className = "card review-card";
    card.dataset.reviewId = String(review.id || "");

    const heading = document.createElement("div");
    heading.className = "review-heading";

    const name = document.createElement("h3");
    name.textContent = isIncluded(review, "name")
      ? String(review.name)
      : "Customer feedback";

    heading.appendChild(name);

    if (isIncluded(review, "rating")) {
      const rating = Number(review.rating);

      if (Number.isInteger(rating) && rating >= 1 && rating <= 5) {
        const stars = document.createElement("span");
        stars.className = "review-stars";
        stars.textContent =
          "★".repeat(rating) + "☆".repeat(5 - rating);

        stars.setAttribute(
          "aria-label",
          `${rating} out of 5 stars`
        );

        heading.appendChild(stars);
      }
    }

    card.appendChild(heading);

    const fields = [
      ["category", "Class / Category"],
      ["sessionDate", "Date of Counselling"],
      ["preExperience", "Pre-Counselling Experience"],
      ["testClarity", "Psychometric Test Clarity"],
      ["oneToOne", "One-on-One Counselling Session"],
      ["roadmapClarity", "Roadmap Clarity"],
      ["rating", "Overall Satisfaction"],
      [
        "confusionBefore",
        "What was your biggest confusion before counselling?"
      ],
      [
        "clarityAfter",
        "How clear are you now after counselling?"
      ],
      [
        "recommendedBy",
        "Who recommended US & LV India (OPC) Pvt Ltd?"
      ],
      [
        "recommend",
        "Would you recommend US & LV India to others?"
      ],

      // Support reviews published using the older form.
      ["counsellor", "Counsellor"],
      ["review", "Feedback"],
      ["helpful", "Questions addressed"],
      ["professionalism", "Professionalism"],
      ["improvements", "Suggestions"]
    ];

    const ratingFields = new Set([
      "preExperience",
      "testClarity",
      "oneToOne",
      "roadmapClarity",
      "rating"
    ]);

    for (const [key, label] of fields) {
      if (!isIncluded(review, key)) continue;

      let value = review[key];

      if (key === "sessionDate") {
        value = formatDate(value);
      } else if (ratingFields.has(key)) {
        value = `${value} / 5`;
      }

      appendAnswer(card, label, value);
    }

    return card;
  }

  async function loadReviews(reset = false) {
    if (loading) return;

    loading = true;
    refreshButton.disabled = true;
    moreButton.disabled = true;

    const requestedPage = reset ? 0 : page;

    panelStatus.textContent = "Loading reviews…";
    mainStatus.textContent = "Loading reviews…";

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    try {
      const response = await fetch(
        `/api/reviews?page=${requestedPage}`,
        {
          cache: "no-store",
          signal: controller.signal
        }
      );

      const contentType = response.headers.get("content-type") || "";

      if (!contentType.includes("application/json")) {
        throw new Error(
          "Reviews could not be loaded. Please use the deployed website."
        );
      }

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.error || "Reviews could not be loaded."
        );
      }

      if (!Array.isArray(data.reviews)) {
        throw new Error("The review response was invalid.");
      }

      updateSummary(data.summary);

      if (reset) {
        list.replaceChildren();
      }

      const existingIds = new Set(
        [...list.children]
          .map((node) => node.dataset.reviewId)
          .filter(Boolean)
      );

      for (const review of data.reviews) {
        if (!review || typeof review !== "object") continue;

        const id = String(review.id || "");

        if (id && existingIds.has(id)) continue;

        list.appendChild(showReview(review));

        if (id) {
          existingIds.add(id);
        }
      }

      page = requestedPage + 1;
      loaded = true;
      moreButton.hidden = !data.hasMore;

      panelStatus.textContent = list.children.length
        ? ""
        : "No reviews have been published yet.";

      mainStatus.textContent = panel.open
        ? ""
        : "Reviews refreshed. Click Open Reviews to view them.";
    } catch (error) {
      const message = error.name === "AbortError"
        ? "Loading took too long. Please click Refresh Reviews to retry."
        : error.message || "Reviews could not be loaded.";

      updateSummary(null);
      panelStatus.textContent = message;
      mainStatus.textContent = message;
    } finally {
      clearTimeout(timeout);
      loading = false;
      refreshButton.disabled = false;
      moreButton.disabled = false;
    }
  }

  function openReviews() {
    if (panel.open) return;

    previousOverflow = document.documentElement.style.overflow;

    panel.showModal();
    document.documentElement.style.overflow = "hidden";
    mainStatus.textContent = "";

    if (!loaded && !loading) {
      loadReviews(true);
    }
  }

  function closeReviews() {
    if (panel.open) {
      panel.close();
    }
  }

  openButton.addEventListener("click", openReviews);
  closeButton.addEventListener("click", closeReviews);

  refreshButton.addEventListener("click", () => {
    loadReviews(true);
  });

  moreButton.addEventListener("click", () => {
    loadReviews(false);
  });

  // Clicking the shaded area outside the panel closes it.
  panel.addEventListener("click", (event) => {
    if (event.target !== panel) return;

    const bounds = panel.getBoundingClientRect();

    const outside =
      event.clientX < bounds.left ||
      event.clientX > bounds.right ||
      event.clientY < bounds.top ||
      event.clientY > bounds.bottom;

    if (outside) {
      closeReviews();
    }
  });

  // Also runs when the visitor presses Escape.
  panel.addEventListener("close", () => {
    document.documentElement.style.overflow = previousOverflow;
    openButton.focus({ preventScroll: true });
  });

  // Load the average on page arrival; review cards remain inside the panel.
  loadReviews(true);
})();
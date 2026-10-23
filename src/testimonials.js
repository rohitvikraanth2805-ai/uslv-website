(() => {
  "use strict";

  const section = document.getElementById("testimonials");
  if (!section) return;

  section.innerHTML = `
    <div class="container">
      <h2 id="testimonialsTitle">Testimonials</h2>

      <div class="review-toolbar">
        <h3>Customer Reviews</h3>
        <button
          type="button"
          class="btn btn-small"
          id="refreshReviews">
          Refresh Reviews
        </button>
      </div>

      <p>Feedback from our counselling clients.</p>
      <p id="reviewsStatus" role="status" aria-live="polite"></p>
      <div id="reviewsList" class="review-list"></div>

      <button
        type="button"
        id="loadMoreReviews"
        class="btn btn-small"
        hidden>
        Load More Reviews
      </button>
    </div>
  `;

  const style = document.createElement("style");

  style.textContent = `
    #testimonials [hidden] {
      display: none !important;
    }

    #testimonials .review-toolbar {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
      margin-bottom: 1rem;
    }

    #testimonials .review-toolbar h3 {
      margin: 0;
    }

    #testimonials .review-list {
      display: grid;
      gap: 1.25rem;
      margin-top: 1rem;
    }

    #testimonials .review-heading {
      display: flex;
      flex-wrap: wrap;
      justify-content: space-between;
      align-items: center;
      gap: .75rem;
    }

    #testimonials .review-stars {
      color: var(--brass-dark);
      font-size: 1.2rem;
    }

    #testimonials .review-meta {
      color: var(--muted);
      font-size: .9rem;
    }

    #testimonials .review-text {
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }

    #testimonials .review-card h3 {
      overflow-wrap: anywhere;
    }

    #testimonials #loadMoreReviews {
      margin-top: 1rem;
    }
  `;

  document.head.appendChild(style);

  const list = section.querySelector("#reviewsList");
  const status = section.querySelector("#reviewsStatus");
  const refresh = section.querySelector("#refreshReviews");
  const more = section.querySelector("#loadMoreReviews");

  let page = 0;
  let loading = false;

  function isIncluded(review, key) {
    if (
      review.schemaVersion === 3 &&
      (
        !Array.isArray(review.selectedFields) ||
        !review.selectedFields.includes(key)
      )
    ) {
      return false;
    }

    return review[key] !== undefined &&
      review[key] !== null &&
      review[key] !== "";
  }

  function answer(card, label, value) {
    const element = document.createElement("p");
    element.className = "review-text";

    const title = document.createElement("strong");
    title.textContent = `${label}: `;

    element.append(title, document.createTextNode(String(value)));
    card.append(element);
  }

  function dateLabel(value) {
    const date = new Date(`${value}T12:00:00`);

    if (Number.isNaN(date.getTime())) return String(value);

    return date.toLocaleDateString("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric"
    });
  }

  function showReview(review) {
    const card = document.createElement("article");
    card.className = "card review-card";
    card.dataset.reviewId = String(review.id || "");

    const heading = document.createElement("div");
    heading.className = "review-heading";

    const name = document.createElement("h3");

    name.textContent = isIncluded(review, "name")
      ? review.name
      : "Customer feedback";

    heading.append(name);

    // No star rating is shown if Overall Satisfaction was unchecked.
    if (isIncluded(review, "rating")) {
      const rating = Math.min(
        5,
        Math.max(0, Math.trunc(Number(review.rating) || 0))
      );

      const stars = document.createElement("span");
      stars.className = "review-stars";
      stars.textContent = "★".repeat(rating) + "☆".repeat(5 - rating);

      stars.setAttribute(
        "aria-label",
        `Overall satisfaction: ${rating} out of 5 stars`
      );

      heading.append(stars);
    }

    card.append(heading);

    if (review.schemaVersion === 2 || review.schemaVersion === 3) {
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
        ]
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
          value = dateLabel(value);
        } else if (ratingFields.has(key)) {
          value = `${value} / 5`;
        }

        answer(card, label, value);
      }
    } else {
      // Preserve reviews created before the Google Form field update.
      if (isIncluded(review, "counsellor")) {
        answer(card, "Counsellor", review.counsellor);
      }

      if (isIncluded(review, "sessionDate")) {
        answer(card, "Session", dateLabel(review.sessionDate));
      }

      if (isIncluded(review, "review")) {
        const text = document.createElement("p");
        text.className = "review-text";
        text.textContent = review.review;
        card.append(text);
      }

      for (const [key, label] of [
        ["helpful", "Questions addressed"],
        ["professionalism", "Professionalism"],
        ["improvements", "Suggestions"]
      ]) {
        if (isIncluded(review, key)) {
          answer(card, label, review[key]);
        }
      }
    }

    return card;
  }

  async function loadReviews(reset = false) {
    if (loading) return;

    loading = true;
    refresh.disabled = true;
    more.disabled = true;

    const requestedPage = reset ? 0 : page;
    status.textContent = "Loading reviews…";

    try {
      const response = await fetch(
        `/api/reviews?page=${requestedPage}`,
        {
          cache: "no-store",
          signal: AbortSignal.timeout(15000)
        }
      );

      const data = await response.json().catch(() => null);

      if (!response.ok || !Array.isArray(data?.reviews)) {
        throw new Error(
          data?.error || "Reviews could not be loaded."
        );
      }

      if (reset) list.replaceChildren();

      const ids = new Set(
        [...list.children].map(node => node.dataset.reviewId)
      );

      for (const review of data.reviews) {
        const id = String(review.id || "");

        if (!id || !ids.has(id)) {
          list.append(showReview(review));
          if (id) ids.add(id);
        }
      }

      page = requestedPage + 1;
      more.hidden = !data.hasMore;
      status.textContent = "";
    } catch (error) {
      status.textContent = error.name === "TimeoutError"
        ? "Loading took too long. Please click Refresh Reviews."
        : error.message;
    } finally {
      loading = false;
      refresh.disabled = false;
      more.disabled = false;
    }
  }

  refresh.addEventListener("click", () => loadReviews(true));
  more.addEventListener("click", () => loadReviews(false));

  loadReviews(true);
})();
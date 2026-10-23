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

  function paragraph(content, className = "review-text") {
    const element = document.createElement("p");
    element.textContent = content;
    element.className = className;
    return element;
  }

  function answer(card, label, value) {
    if (value === undefined || value === null || value === "") return;

    const element = document.createElement("p");
    element.className = "review-text";

    const title = document.createElement("strong");
    title.textContent = `${label}: `;

    element.append(title, document.createTextNode(String(value)));
    card.append(element);
  }

  function dateLabel(value) {
    if (!value) return "";

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
    name.textContent = review.name || "Customer";

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

    heading.append(name, stars);
    card.append(heading);

    const when = dateLabel(review.sessionDate);

    if (review.schemaVersion === 2) {
      answer(card, "Class / Category", review.category);
      answer(card, "Date of Counselling", when);

      const ratings = [
        ["preExperience", "Pre-Counselling Experience"],
        ["testClarity", "Psychometric Test Clarity"],
        ["oneToOne", "One-on-One Counselling Session"],
        ["roadmapClarity", "Roadmap Clarity"],
        ["rating", "Overall Satisfaction"]
      ];

      ratings.forEach(([key, label]) => {
        if (review[key] !== undefined) {
          answer(card, label, `${review[key]} / 5`);
        }
      });

      answer(
        card,
        "What was your biggest confusion before counselling?",
        review.confusionBefore
      );

      answer(
        card,
        "How clear are you now after counselling?",
        review.clarityAfter
      );

      answer(
        card,
        "Who recommended US & LV India (OPC) Pvt Ltd?",
        review.recommendedBy
      );

      answer(
        card,
        "Would you recommend US & LV India to others?",
        review.recommend
      );
    } else {
      const metadata = [];

      if (review.counsellor) {
        metadata.push(`Counsellor: ${review.counsellor}`);
      }

      if (when) {
        metadata.push(`Session: ${when}`);
      }

      if (metadata.length) {
        card.append(paragraph(metadata.join(" • "), "review-meta"));
      }

      if (review.review) {
        card.append(paragraph(review.review));
      }

      answer(card, "Questions addressed", review.helpful);
      answer(card, "Professionalism", review.professionalism);
      answer(card, "Suggestions", review.improvements);
    }

    // Never render the customer's email address.
    // Customer text is inserted as textContent/text nodes, not HTML.
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
          data?.error ||
          "Reviews could not be loaded. Please use the deployed website."
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

      // Preserve the existing blank state when no reviews exist.
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
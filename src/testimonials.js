(() => {
  "use strict";

  const section = document.getElementById("testimonials");
  if (!section) return;

  const API = "/api/reviews";

  // Scoped styles preserve the rest of the website.
  const style = document.createElement("style");

  style.textContent = `
    #testimonials [hidden] {
      display: none !important;
    }

    #testimonials .review-tabs {
      display: flex;
      flex-wrap: wrap;
      gap: .75rem;
      margin: 1.5rem 0;
    }

    #testimonials .review-tab {
      background: transparent;
      color: var(--teal-700);
      border-color: var(--line);
    }

    #testimonials .review-tab[aria-selected="true"] {
      background: var(--teal-700);
      border-color: var(--teal-700);
      color: #fff;
    }

    #testimonials .review-toolbar,
    #testimonials .review-heading {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: .75rem;
      margin-bottom: 1rem;
    }

    #testimonials .review-toolbar p,
    #testimonials .review-heading h3 {
      margin: 0;
    }

    #testimonials .review-list {
      display: grid;
      gap: 1.25rem;
      margin-top: 1rem;
    }

    #testimonials .review-stars {
      color: var(--brass-dark);
      font-size: 1.2rem;
      letter-spacing: .08em;
    }

    #testimonials .review-meta,
    #testimonials .review-notice {
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

    #testimonials .review-card p:last-child {
      margin-bottom: 0;
    }

    #testimonials fieldset {
      border: 0;
      padding: 0;
      margin: 0 0 1.5rem;
      min-width: 0;
    }

    #testimonials legend {
      font-weight: 600;
      padding: 0;
      margin-bottom: .75rem;
    }

    #testimonials .review-options {
      display: flex;
      flex-wrap: wrap;
      gap: .75rem 1.25rem;
    }

    #testimonials .review-options label,
    #testimonials .review-consent {
      display: flex;
      align-items: flex-start;
      gap: .5rem;
      font-weight: 400;
      cursor: pointer;
    }

    #testimonials input[type="radio"],
    #testimonials input[type="checkbox"] {
      width: auto;
      flex-shrink: 0;
      margin-top: .35rem;
      accent-color: var(--teal-700);
    }

    #testimonials .review-more {
      margin-top: 1.25rem;
    }
  `;

  document.head.appendChild(style);

  // Values passed to this helper are fixed labels, never customer text.
  function choices(name, items) {
    return items.map(([value, label]) => `
      <label>
        <input
          type="radio"
          name="${name}"
          value="${value}"
          required>
        <span>${label}</span>
      </label>
    `).join("");
  }

  section.innerHTML = `
    <div class="container">
      <h2 id="testimonialsTitle">Testimonials</h2>
      <p class="lead">
        Share your counselling experience with us.
      </p>

      <div
        class="review-tabs"
        role="tablist"
        aria-label="Testimonials">

        <button
          type="button"
          class="btn review-tab"
          id="reviewsTab"
          role="tab"
          aria-selected="true"
          aria-controls="reviewsPanel"
          tabindex="0">
          Customer Reviews
        </button>

        <button
          type="button"
          class="btn review-tab"
          id="writeReviewTab"
          role="tab"
          aria-selected="false"
          aria-controls="writeReviewPanel"
          tabindex="-1">
          Write a Review
        </button>
      </div>

      <p
        id="reviewNotice"
        class="form-status"
        role="status"
        aria-live="polite"></p>

      <div
        id="reviewsPanel"
        role="tabpanel"
        aria-labelledby="reviewsTab"
        tabindex="0">

        <div class="review-toolbar">
          <p>Feedback from our counselling clients.</p>

          <button
            type="button"
            class="btn btn-small"
            id="refreshReviews">
            Refresh Reviews
          </button>
        </div>

        <p
          id="reviewsStatus"
          role="status"
          aria-live="polite"></p>

        <div id="reviewsList" class="review-list"></div>

        <button
          type="button"
          class="btn btn-small review-more"
          id="loadMoreReviews"
          hidden>
          Load More Reviews
        </button>
      </div>

      <div
        id="writeReviewPanel"
        role="tabpanel"
        aria-labelledby="writeReviewTab"
        tabindex="0"
        hidden>

        <form id="counsellingReviewForm" class="card">
          <h3>Counselling Feedback Form</h3>

          <p>
            Please take a moment to share your experience
            with our counselling service.
          </p>

          <p class="review-notice">
            Your display name and all feedback below will be public.
            Please do not include phone numbers, email addresses
            or sensitive personal information.
          </p>

          <div class="row">
            <div class="field">
              <label for="reviewName">Display Name *</label>
              <input
                id="reviewName"
                name="name"
                type="text"
                minlength="2"
                maxlength="80"
                placeholder="Your public display name"
                required>
            </div>

            <div class="field">
              <label for="reviewDate">Date of Counselling *</label>
              <input
                id="reviewDate"
                name="sessionDate"
                type="date"
                required>
            </div>
          </div>

          <div class="field">
            <label for="reviewCounsellor">Counsellor / Advisor *</label>
            <input
              id="reviewCounsellor"
              name="counsellor"
              type="text"
              minlength="2"
              maxlength="100"
              placeholder="Name of your counsellor or advisor"
              required>
          </div>

          <fieldset>
            <legend>
              1. How satisfied were you with the counselling session? *
            </legend>

            <div class="review-options">
              ${choices("rating", [
                ["5", "Very Satisfied — 5 stars"],
                ["4", "Satisfied — 4 stars"],
                ["3", "Neutral — 3 stars"],
                ["2", "Unsatisfied — 2 stars"],
                ["1", "Very Unsatisfied — 1 star"]
              ])}
            </div>
          </fieldset>

          <fieldset>
            <legend>
              2. Did the session help address your questions? *
            </legend>

            <div class="review-options">
              ${choices("helpful", [
                ["Yes", "Yes"],
                ["Partly", "Partly"],
                ["No", "No"]
              ])}
            </div>
          </fieldset>

          <fieldset>
            <legend>
              3. How would you rate the counsellor's professionalism? *
            </legend>

            <div class="review-options">
              ${choices("professionalism", [
                ["Excellent", "Excellent"],
                ["Good", "Good"],
                ["Fair", "Fair"],
                ["Poor", "Poor"]
              ])}
            </div>
          </fieldset>

          <div class="field">
            <label for="reviewMessage">
              4. Share your counselling experience *
            </label>

            <textarea
              id="reviewMessage"
              name="review"
              rows="5"
              minlength="10"
              maxlength="1500"
              placeholder="Write your review (at least 10 characters)"
              required></textarea>
          </div>

          <div class="field">
            <label for="reviewImprovements">
              5. What could we improve? (Optional)
            </label>

            <textarea
              id="reviewImprovements"
              name="improvements"
              rows="4"
              maxlength="1000"
              placeholder="Your suggestions"></textarea>
          </div>

          <div class="field">
            <label class="review-consent">
              <input type="checkbox" name="consent" required>
              <span>
                I agree to publish my display name and all feedback
                entered in this form on this website.
              </span>
            </label>
          </div>

          <button
            type="submit"
            id="submitReview"
            class="btn btn-primary">
            Submit Review
          </button>
        </form>
      </div>
    </div>
  `;

  const find = (selector) => section.querySelector(selector);

  const tabs = [
    find("#reviewsTab"),
    find("#writeReviewTab")
  ];

  const panels = [
    find("#reviewsPanel"),
    find("#writeReviewPanel")
  ];

  const form = find("#counsellingReviewForm");
  const list = find("#reviewsList");
  const notice = find("#reviewNotice");
  const status = find("#reviewsStatus");
  const submitButton = find("#submitReview");
  const refreshButton = find("#refreshReviews");
  const moreButton = find("#loadMoreReviews");

  let nextPage = 0;
  let loading = false;
  let submitting = false;
  let pendingSubmission = null;

  const today = new Date();

  find("#reviewDate").max = [
    today.getFullYear(),
    String(today.getMonth() + 1).padStart(2, "0"),
    String(today.getDate()).padStart(2, "0")
  ].join("-");

  function selectTab(index, focus = false) {
    tabs.forEach((tab, current) => {
      const selected = current === index;

      tab.setAttribute("aria-selected", String(selected));
      tab.tabIndex = selected ? 0 : -1;
      panels[current].hidden = !selected;
    });

    if (focus) tabs[index].focus();
  }

  tabs.forEach((tab, index) => {
    tab.addEventListener("click", () => selectTab(index));

    tab.addEventListener("keydown", (event) => {
      let next;

      if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
        next = index === 0 ? 1 : 0;
      } else if (event.key === "Home") {
        next = 0;
      } else if (event.key === "End") {
        next = 1;
      } else {
        return;
      }

      event.preventDefault();
      selectTab(next, true);
    });
  });

  async function request(url, payload) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);

    try {
      const response = await fetch(url, {
        method: payload ? "POST" : "GET",
        headers: payload
          ? { "Content-Type": "application/json" }
          : {},
        body: payload ? JSON.stringify(payload) : undefined,
        cache: "no-store",
        signal: controller.signal
      });

      const data = await response.json().catch(() => null);

      if (!data) {
        throw new Error(
          "The reviews API is unavailable. Please use the deployed website."
        );
      }

      if (!response.ok) {
        throw new Error(data.error || "The request failed.");
      }

      return data;
    } finally {
      clearTimeout(timer);
    }
  }

  function paragraph(text, className = "") {
    const element = document.createElement("p");
    element.className = className;
    element.textContent = text;
    return element;
  }

  function renderReview(review) {
    const card = document.createElement("article");
    card.className = "card review-card";
    card.dataset.reviewId = review.id;

    const heading = document.createElement("div");
    heading.className = "review-heading";

    const name = document.createElement("h3");
    name.textContent = review.name;

    const stars = document.createElement("span");
    stars.className = "review-stars";
    stars.setAttribute("role", "img");
    stars.setAttribute(
      "aria-label",
      `${review.rating} out of 5 stars`
    );

    stars.textContent =
      "★".repeat(review.rating) +
      "☆".repeat(5 - review.rating);

    heading.append(name, stars);

    const date = new Date(
      review.sessionDate + "T12:00:00"
    ).toLocaleDateString("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric"
    });

    card.append(
      heading,
      paragraph(
        `Counsellor: ${review.counsellor} • Session: ${date}`,
        "review-meta"
      ),
      paragraph(review.review, "review-text"),
      paragraph(
        `Questions addressed: ${review.helpful} • ` +
        `Professionalism: ${review.professionalism}`,
        "review-meta"
      )
    );

    if (review.improvements) {
      card.append(
        paragraph(
          `Suggestions: ${review.improvements}`,
          "review-text"
        )
      );
    }

    // Customer text is displayed as text, never executed as HTML.
    return card;
  }

  async function loadReviews(reset = false) {
    if (loading) return;

    loading = true;
    refreshButton.disabled = true;
    moreButton.disabled = true;
    status.textContent = "Loading reviews…";

    const page = reset ? 0 : nextPage;

    try {
      const data = await request(`${API}?page=${page}`);

      if (reset) list.replaceChildren();

      const shownIds = new Set(
        [...list.children].map((card) => card.dataset.reviewId)
      );

      for (const review of data.reviews) {
        if (!shownIds.has(review.id)) {
          list.append(renderReview(review));
          shownIds.add(review.id);
        }
      }

      nextPage = page + 1;
      moreButton.hidden = !data.hasMore;

      status.textContent = list.children.length
        ? `${list.children.length} review(s) displayed.`
        : "No reviews yet. Be the first to share your experience.";
    } catch (error) {
      status.textContent =
        error.name === "AbortError"
          ? "Loading took too long. Click Refresh Reviews to try again."
          : error.message;
    } finally {
      loading = false;
      refreshButton.disabled = false;
      moreButton.disabled = false;
    }
  }

  refreshButton.addEventListener("click", () => loadReviews(true));
  moreButton.addEventListener("click", () => loadReviews());

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (submitting || !form.reportValidity()) return;

    const values = new FormData(form);
    const text = (key) => String(values.get(key) || "").trim();

    const payload = {
      name: text("name"),
      sessionDate: text("sessionDate"),
      counsellor: text("counsellor"),
      rating: Number(values.get("rating")),
      helpful: text("helpful"),
      professionalism: text("professionalism"),
      review: text("review"),
      improvements: text("improvements"),
      consent: values.get("consent") === "on"
    };

    if (
      payload.name.length < 2 ||
      payload.counsellor.length < 2 ||
      payload.review.length < 10
    ) {
      notice.className = "form-status err";
      notice.textContent =
        "Please enter a name, counsellor and at least 10 characters of feedback.";
      return;
    }

    const signature = JSON.stringify(payload);

    if (!pendingSubmission || pendingSubmission.signature !== signature) {
      pendingSubmission = {
        signature,
        requestId: crypto.randomUUID()
      };
    }

    submitting = true;
    submitButton.disabled = true;
    submitButton.textContent = "Submitting…";
    notice.className = "form-status";
    notice.textContent = "Saving your review…";

    let saved = false;

    try {
      await request(API, {
        ...payload,
        requestId: pendingSubmission.requestId
      });

      saved = true;
      pendingSubmission = null;
      form.reset();

      notice.className = "form-status success";
      notice.textContent =
        "Thank you! Your review has been published.";

      selectTab(0, true);
    } catch (error) {
      notice.className = "form-status err";
      notice.textContent =
        error.name === "AbortError"
          ? "Submission took too long. Please retry without changing the form."
          : error.message;
    } finally {
      submitting = false;
      submitButton.disabled = false;
      submitButton.textContent = "Submit Review";
    }

    if (saved) {
      if (!loading) {
        await loadReviews(true);
      } else {
        status.textContent =
          "Your review is saved. Click Refresh Reviews after loading finishes.";
      }
    }
  });

  loadReviews(true);
})();
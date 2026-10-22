
(() => {
  "use strict";

  const section = document.getElementById("testimonials");
  if (!section) return;

  section.innerHTML = `
    <div class="container">
      <h2 id="testimonialsTitle">Testimonials</h2>
      <div class="review-toolbar">
        <h3>Customer Reviews</h3>
        <button type="button" class="btn btn-small" id="refreshReviews">
          Refresh Reviews
        </button>
      </div>
      <p>Feedback from our counselling clients.</p>
      <p id="reviewsStatus" role="status" aria-live="polite"></p>
      <div id="reviewsList" class="review-list"></div>
      <button type="button" id="loadMoreReviews" class="btn btn-small" hidden>
        Load More Reviews
      </button>
    </div>
  `;

  const style = document.createElement("style");
  style.textContent = `
    #testimonials [hidden] { display: none !important; }
    #testimonials .review-toolbar {
      display: flex; flex-wrap: wrap; align-items: center;
      justify-content: space-between; gap: 1rem; margin-bottom: 1rem;
    }
    #testimonials .review-toolbar h3 { margin: 0; }
    #testimonials .review-list { display: grid; gap: 1.25rem; margin-top: 1rem; }
    #testimonials .review-heading {
      display: flex; flex-wrap: wrap; justify-content: space-between;
      align-items: center; gap: .75rem;
    }
    #testimonials .review-stars { color: var(--brass-dark); font-size: 1.2rem; }
    #testimonials .review-meta { color: var(--muted); font-size: .9rem; }
    #testimonials .review-text { white-space: pre-wrap; overflow-wrap: anywhere; }
    #testimonials .review-card h3 { overflow-wrap: anywhere; }
    #testimonials #loadMoreReviews { margin-top: 1rem; }
  `;
  document.head.appendChild(style);

  const list = section.querySelector("#reviewsList");
  const status = section.querySelector("#reviewsStatus");
  const refresh = section.querySelector("#refreshReviews");
  const more = section.querySelector("#loadMoreReviews");
  let page = 0;
  let loading = false;

  function p(content, className) {
    const element = document.createElement("p");
    element.textContent = content;
    if (className) element.className = className;
    return element;
  }

  function showReview(review) {
    const card = document.createElement("article");
    card.className = "card review-card";
    card.dataset.reviewId = String(review.id || "");

    const heading = document.createElement("div");
    heading.className = "review-heading";
    const name = document.createElement("h3");
    name.textContent = review.name || "Customer";
    const stars = document.createElement("span");
    stars.className = "review-stars";
    const rating = Math.min(5, Math.max(0, Number(review.rating) || 0));
    stars.textContent = "★".repeat(rating) + "☆".repeat(5 - rating);
    stars.setAttribute("aria-label", `${rating} out of 5 stars`);
    heading.append(name, stars);
    card.append(heading);

    const when = review.sessionDate
      ? new Date(`${review.sessionDate}T12:00:00`).toLocaleDateString("en-IN", {
          day: "numeric", month: "short", year: "numeric"
        })
      : "";
    card.append(p(`Counsellor: ${review.counsellor || ""} • Session: ${when}`, "review-meta"));
    card.append(p(review.review || "", "review-text"));
    if (review.helpful || review.professionalism) {
      card.append(p(
        `Questions addressed: ${review.helpful || "-"} • Professionalism: ${review.professionalism || "-"}`,
        "review-meta"
      ));
    }
    if (review.improvements) card.append(p(`Suggestions: ${review.improvements}`, "review-text"));
    // User content is always inserted using textContent, not HTML.
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
      const response = await fetch(`/api/reviews?page=${requestedPage}`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Reviews could not be loaded.");
      if (reset) list.replaceChildren();
      const ids = new Set([...list.children].map(node => node.dataset.reviewId));
      for (const review of data.reviews || []) {
        if (!ids.has(review.id)) {
          list.append(showReview(review));
          ids.add(review.id);
        }
      }
      page = requestedPage + 1;
      more.hidden = !data.hasMore;
      // Intentionally show no empty-state message when there are no reviews.
      status.textContent = "";
    } catch (error) {
      status.textContent = error.message || "Reviews could not be loaded.";
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

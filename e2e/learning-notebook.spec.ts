import { expect, test } from "@playwright/test";

const uid = () => Math.random().toString(36).slice(2, 8);

test.describe("Learning module", () => {
  test("create topic, add card, view detail, set mastery, debounce view count", async ({
    page,
  }) => {
    const topicName = `React internals ${uid()}`;
    const cardTitle = `What is Fiber? ${uid()}`;

    // Home → empty state, can create a topic
    await page.goto("/learn");
    await expect(
      page.getByRole("heading", { name: "Learning" })
    ).toBeVisible();

    await page.getByRole("button", { name: "New Topic" }).click();
    const topicInput = page.getByPlaceholder("Topic name (e.g. React internals)");
    await topicInput.fill(topicName);
    await page.getByRole("button", { name: "Create" }).click();

    // Topic should appear on the home grid
    const topicCard = page
      .getByTestId("topic-card")
      .filter({ hasText: topicName });
    await expect(topicCard).toBeVisible();
    await topicCard.click();

    // Topic detail page
    await expect(
      page.getByRole("heading", { name: topicName })
    ).toBeVisible();
    await expect(page.getByText("No cards in this filter yet.")).toBeVisible();

    // Add a card
    await page.getByRole("link", { name: /Add Card/ }).click();
    await page.getByTestId("new-card-title").fill(cardTitle);
    await page.locator(".ProseMirror").click();
    await page.locator(".ProseMirror").pressSequentially("Fiber is a unit of work.", { delay: 10 });
    await page.getByTestId("new-card-save").click();

    // Land on card detail; viewCount becomes 1 after the debounced increment
    await expect(page).toHaveURL(/\/learn\/[^/]+\/[^/]+$/);
    await expect(page.getByRole("heading", { name: cardTitle })).toBeVisible();
    await expect(page.getByTestId("view-count-meta")).toContainText(
      /Viewed 1 times/,
      { timeout: 5000 }
    );

    // Set mastery to "Mastered"
    await page.getByTestId("mastery-mastered").click();
    await expect(page.getByTestId("mastery-mastered")).toHaveAttribute(
      "aria-checked",
      "true"
    );

    // Go back to topic; mastery badge should reflect "Mastered"
    await page.getByRole("link", { name: /Back to topic/ }).click();
    const cardRow = page.getByTestId("card-row").filter({ hasText: cardTitle });
    await expect(cardRow.getByTestId("mastery-badge")).toHaveText("Mastered");
    await expect(cardRow.getByTestId("view-count")).toContainText("1");

    // "Mastered" filter should still show it; "Not Mastered" should hide it
    await page.getByRole("tab", { name: "Mastered", exact: true }).click();
    await expect(
      page.getByTestId("card-row").filter({ hasText: cardTitle })
    ).toBeVisible();
    await page.getByRole("tab", { name: "Not Mastered" }).click();
    await expect(page.getByText("No cards in this filter yet.")).toBeVisible();
    await page.getByRole("tab", { name: "All" }).click();

    // Re-enter detail page within 5 minutes — view count should NOT increase
    await page.getByTestId("card-row").filter({ hasText: cardTitle }).click();
    await expect(page.getByRole("heading", { name: cardTitle })).toBeVisible();
    // Wait a beat then verify still 1
    await page.waitForTimeout(500);
    await expect(page.getByTestId("view-count-meta")).toContainText(
      /Viewed 1 times/
    );
  });

  test("topic counters reflect mastered cards on home grid", async ({
    page,
  }) => {
    const topicName = `Browsers ${uid()}`;
    const cardTitle = `What is the critical rendering path? ${uid()}`;

    await page.goto("/learn");
    await page.getByRole("button", { name: "New Topic" }).click();
    await page.getByPlaceholder("Topic name (e.g. React internals)").fill(topicName);
    await page.getByRole("button", { name: "Create" }).click();

    await page
      .getByTestId("topic-card")
      .filter({ hasText: topicName })
      .click();

    await page.getByRole("link", { name: /Add Card/ }).click();
    await page.getByTestId("new-card-title").fill(cardTitle);
    await page.locator(".ProseMirror").click();
    await page.locator(".ProseMirror").pressSequentially("Layout, paint, composite.", { delay: 10 });
    await page.getByTestId("new-card-save").click();

    await page.getByTestId("mastery-mastered").click();
    await expect(page.getByTestId("mastery-mastered")).toHaveAttribute(
      "aria-checked",
      "true"
    );

    await page.goto("/learn");
    const card = page.getByTestId("topic-card").filter({ hasText: topicName });
    await expect(card.getByTestId("topic-card-counts")).toContainText(
      "1 cards"
    );
    await expect(card.getByTestId("topic-card-counts")).toContainText(
      "1 mastered"
    );
  });
});

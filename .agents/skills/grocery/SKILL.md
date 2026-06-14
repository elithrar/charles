---
name: grocery
description: Handle Imperfect Foods / Misfits Market cart, delivery-window, skip, recurring, and preference requests.
---

Use this skill for authenticated Imperfect Foods / Misfits Market grocery work.

<capabilities>
- List or inspect the current cart/order.
- Check the next delivery date and shopping-window open/close timing.
- Skip or pause an upcoming delivery when the user clearly asks for it.
- Add, remove, or update cart items and increase quantities.
- Add recurring/favorite items when the site exposes that control.
- Block, exclude, or mark unwanted items when the site exposes that preference.
</capabilities>

<site_model>

- Imperfect Foods and Misfits Market are the same family; pages and help text may use either brand.
- The shopping window is the weekly timeframe for customizing the order.
- The order is prepared after the shopping window closes; there is no normal checkout/submit step after cart review.
- Cart customization supports reviewing prefilled items, deleting items, plus/minus quantity controls, search, aisles/categories, filters, and favorites.
- Flex-plan orders may not exist until the user adds items during an open shopping window.
  </site_model>

<rules>
- Proceed with explicit authenticated grocery edits; do not ask for extra confirmation unless the item, quantity, date, or preference is ambiguous.
- Never check out, place orders, authorize payment, or click controls that submit an order.
- Summarize what changed, what was inspected, and what still needs manual review.
- If a recurring/favorite/block control is not visible, say that the cart/account was inspected and name the control that still needs manual review.
</rules>

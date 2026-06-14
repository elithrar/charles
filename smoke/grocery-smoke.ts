import { runGroceryCartRequest } from '../src/services/grocery.ts';

export default {
  async fetch(request, env) {
    if (new URL(request.url).pathname === '/health') {
      return Response.json({ ok: true });
    }

    const result = await runGroceryCartRequest(
      { prompt: 'show my current Imperfect Foods cart and shopping window', dryRun: true },
      env,
    );

    if ('error' in result) {
      return Response.json({ ok: false, error: result.error.message }, { status: 500 });
    }

    return Response.json({
      ok: true,
      status: result.value.status,
      actionTypes: result.value.plannedActions.map((action) => action.type),
      cartItemCount: result.value.cartItems.length,
      cartItems: result.value.cartItems.slice(0, 20),
      reviewRequired: result.value.reviewRequired,
      browserSnapshot: result.value.browserSnapshot,
      checkoutBlocked: result.value.checkoutBlocked,
    });
  },
} satisfies ExportedHandler<Env>;

import { nextTick } from "vue";
import { createRouter, createWebHashHistory } from "vue-router";
import { routes } from "vue-router/auto-routes";

const router = createRouter({
	history: createWebHashHistory(),
	routes,
});

let isFirstNavigation = true;

router.beforeEach((_to, _from, next) => {
	if (isFirstNavigation) {
		isFirstNavigation = false;
		next();
		return;
	}

	if (typeof document === "undefined" || !document.startViewTransition) {
		next();
		return;
	}

	document.startViewTransition(async () => {
		next();
		await nextTick();
	});
});

export default router;

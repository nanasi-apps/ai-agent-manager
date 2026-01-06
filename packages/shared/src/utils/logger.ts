import { configure, getConsoleSink, getLogger } from "@logtape/logtape";

export function initLogger() {
	configure({
		sinks: {
			console: getConsoleSink(),
		},
		filters: {},
		loggers: [{ category: [], sinks: ["console"], lowestLevel: "debug" }],
	});
}

export { getLogger };

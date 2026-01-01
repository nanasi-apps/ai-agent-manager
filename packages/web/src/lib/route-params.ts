export const getRouteParam = (
	param: string | string[] | undefined,
): string | undefined => (Array.isArray(param) ? param[0] : param);

export const getRouteParamFrom = (
	params: Record<string, string | string[] | undefined>,
	key: string,
): string | undefined => getRouteParam(params[key]);

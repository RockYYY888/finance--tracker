declare module "recharts/es6/hooks" {
	export function useXAxis(
		xAxisId: number | string,
	): {
		scale?: (value: number) => number;
	} | undefined;

	export function useYAxis(
		yAxisId: number | string,
	): {
		scale?: (value: number) => number;
	} | undefined;
}

import { createApiClient } from "./apiClient";
import type { DashboardResponse } from "../types/dashboard";

const dashboardApiClient = createApiClient();

export async function getDashboard(forceRefresh = false): Promise<DashboardResponse> {
	return dashboardApiClient.request<DashboardResponse>(
		forceRefresh ? "/api/dashboard?refresh=1" : "/api/dashboard",
	);
}

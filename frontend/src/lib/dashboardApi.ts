import { createApiClient } from "./apiClient";
import type { DashboardResponse } from "../types/dashboard";

const dashboardApiClient = createApiClient();

export async function getDashboard(): Promise<DashboardResponse> {
	return dashboardApiClient.request<DashboardResponse>("/api/dashboard");
}

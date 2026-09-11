export interface NotificationPreferences { strongSdMagnet: boolean; swingLiquidity: boolean; swingForecast: boolean; buy: boolean; sell: boolean; win: boolean; loss: boolean; }
export interface PushRegistration { token: string; platform: "android" | "ios" | "web"; }
export async function registerForPushNotifications(): Promise<PushRegistration | null> { return null; }

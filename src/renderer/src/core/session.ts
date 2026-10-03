let deviceId: string | null = null

/** 启动时从 app:info 拿一次；写进度时带上（TECH.md 6.1）。 */
export function setDeviceId(id: string): void {
  deviceId = id.length > 0 ? id : null
}

export function currentDeviceId(): string | null {
  return deviceId
}

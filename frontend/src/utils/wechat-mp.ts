export function shouldShowWechatMp(
  isOnlineEdition: boolean,
  region?: string,
): boolean {
  return isOnlineEdition && region === "cn";
}

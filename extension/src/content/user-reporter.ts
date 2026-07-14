export async function reportCurrentUser(
  _sendMessage: (message: unknown) => Promise<unknown>,
): Promise<void> {
  // Browser-side account probing caused noisy cross-site Bilibili nav requests.
  // Provider authorization is verified server-side instead.
}

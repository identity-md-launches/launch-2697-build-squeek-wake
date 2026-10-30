// Native wallet access: EIP-6963 discovery, window.ethereum fallback, provider.request() only.

export interface Eip1193 {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
  on?(event: string, fn: (...args: unknown[]) => void): void;
  removeListener?(event: string, fn: (...args: unknown[]) => void): void;
}

export interface WalletInfo { uuid: string; name: string; icon: string; rdns: string }
export interface Discovered { info: WalletInfo; provider: Eip1193 }

export const SEPOLIA = {
  chainId: "0xaa36a7",
  chainIdDec: 11155111,
  chainName: "Ethereum Sepolia",
  nativeCurrency: { name: "Sepolia Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: ["https://ethereum-sepolia-rpc.publicnode.com"],
  blockExplorerUrls: ["https://eth-sepolia.blockscout.com"],
};

/**
 * Open this page inside a wallet's own browser on phones (vendor-documented links, no relay).
 * Rabby documents no such link, so Rabby Mobile users open the page from its built-in browser.
 */
export const OPEN_IN: ReadonlyArray<{ id: string; name: string; href: (url: string) => string }> = [
  { id: "metamask", name: "MetaMask", href: (url) => `https://link.metamask.io/dapp/${url.replace(/^https?:\/\//, "")}` },
  { id: "coinbase", name: "Coinbase Wallet", href: (url) => `https://go.cb-w.com/dapp?cb_url=${encodeURIComponent(url)}` },
  { id: "phantom", name: "Phantom", href: (url) => `https://phantom.app/ul/browse/${encodeURIComponent(url)}?ref=${encodeURIComponent(new URL(url).origin)}` },
];

export const isMobileBrowser = () =>
  /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) && !(window as unknown as { ethereum?: unknown }).ethereum;

const discovered = new Map<string, Discovered>();
let onDiscover: () => void = () => {};

export function startDiscovery(cb: () => void): void {
  onDiscover = cb;
  window.addEventListener("eip6963:announceProvider", ((e: CustomEvent<Discovered>) => {
    const d = e.detail;
    if (!d?.info?.uuid || !d.provider) return;
    discovered.set(d.info.uuid, d);
    onDiscover();
  }) as EventListener);
  window.dispatchEvent(new Event("eip6963:requestProvider"));
}

export function listWallets(): Discovered[] {
  const list = [...discovered.values()];
  const injected = (window as unknown as { ethereum?: Eip1193 }).ethereum;
  if (!list.length && injected) {
    list.push({ info: { uuid: "injected", name: "Browser wallet", icon: "", rdns: "injected" }, provider: injected });
  }
  return list;
}

export interface WalletErr { code?: number; message?: string }

export function errText(e: unknown): string {
  const err = (e ?? {}) as WalletErr & { data?: { message?: string } };
  if (err.code === 4001) return "Request rejected in the wallet.";
  if (err.code === -32002) return "The wallet already has a pending request. Open it to continue.";
  return err.data?.message || err.message || "The wallet returned an error.";
}

export async function ensureSepolia(p: Eip1193): Promise<void> {
  const current = String(await p.request({ method: "eth_chainId" })).toLowerCase();
  if (current === SEPOLIA.chainId) return;
  try {
    await p.request({ method: "wallet_switchEthereumChain", params: [{ chainId: SEPOLIA.chainId }] });
  } catch (e) {
    const code = (e as WalletErr).code;
    // 4902: unknown chain. Some wallets wrap it as -32603 with the same meaning.
    if (code !== 4902 && code !== -32603) throw e;
    await p.request({
      method: "wallet_addEthereumChain",
      params: [{
        chainId: SEPOLIA.chainId,
        chainName: SEPOLIA.chainName,
        nativeCurrency: SEPOLIA.nativeCurrency,
        rpcUrls: SEPOLIA.rpcUrls,
        blockExplorerUrls: SEPOLIA.blockExplorerUrls,
      }],
    });
    // Adding a network does not select it (EIP-3085).
    await p.request({ method: "wallet_switchEthereumChain", params: [{ chainId: SEPOLIA.chainId }] });
  }
  const selected = String(await p.request({ method: "eth_chainId" })).toLowerCase();
  if (selected !== SEPOLIA.chainId) {
    throw new Error("The wallet is still off Sepolia. Switch to Ethereum Sepolia in your wallet, then try again.");
  }
}

export const shortAddr = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

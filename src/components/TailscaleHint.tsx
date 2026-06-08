/**
 * Boilerplate hint shown under any red error that could plausibly be caused
 * by the device losing its Tailscale connection. Receivers (especially on
 * iOS in airplane-mode + WiFi-only) hit this regularly when the Tailscale
 * app gets suspended in the background; the request to the proxy never
 * leaves the phone and we surface a generic "load failed" / "submission
 * failed" message that doesn't point at the real cause.
 */
export function TailscaleHint() {
  return (
    <p className="text-xs text-text-secondary mt-2">
      If this keeps happening, open the <span className="font-medium">Tailscale</span> app and make sure the VPN is added and turned <span className="font-medium">ON</span>.
    </p>
  );
}

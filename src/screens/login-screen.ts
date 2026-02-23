import { signIn } from "../lib/auth";

export function renderLoginScreen(
  container: HTMLElement,
  onSignedIn: () => void
): void {
  container.innerHTML = `
    <div class="screen login-screen">
      <div class="login-hero">
        <div class="app-icon">📷</div>
        <h1>Part Photo Scanner</h1>
        <p>Scan barcodes, capture photos, and upload to OneDrive</p>
      </div>
      <button id="sign-in-btn" class="btn btn-primary btn-large">
        Sign in with Microsoft
      </button>
      <p class="login-hint">
        Uses your Microsoft account to access OneDrive files
      </p>
    </div>
  `;

  const btn = container.querySelector("#sign-in-btn") as HTMLButtonElement;
  btn.addEventListener("click", async () => {
    btn.disabled = true;
    btn.textContent = "Signing in...";
    try {
      const account = await signIn();
      if (account) {
        onSignedIn();
      }
      // If null, a redirect is happening (iOS)
    } catch (err) {
      btn.disabled = false;
      btn.textContent = "Sign in with Microsoft";
      showError(container, (err as Error).message);
    }
  });
}

function showError(container: HTMLElement, message: string): void {
  let errEl = container.querySelector(".login-error") as HTMLElement;
  if (!errEl) {
    errEl = document.createElement("p");
    errEl.className = "login-error error-text";
    container.querySelector(".login-screen")!.appendChild(errEl);
  }
  errEl.textContent = message;
}

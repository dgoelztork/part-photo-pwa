
import { useAuthStore } from "../stores/auth-store";

export function Login() {
  const { signIn, error } = useAuthStore();

  return (
    <div className="min-h-full flex flex-col items-center justify-center p-4 text-center safe-top safe-bottom">
      <div className="mb-8">
        <div className="text-6xl mb-4">&#128230;</div>
        <h1 className="text-2xl font-bold text-text">Part Receiving</h1>
        <p className="text-text-secondary mt-2">
          Warehouse receiving workflow
        </p>
      </div>

      <button
        onClick={signIn}
        className="w-full max-w-xs py-4 rounded-xl bg-primary text-white font-semibold text-base
                   active:scale-[0.98] transition-transform"
      >
        Sign in with Microsoft
      </button>

      <p className="text-xs text-text-secondary mt-3">
        Uses your company Microsoft account
      </p>

      {error && (
        <p className="text-error text-sm mt-3">{error}</p>
      )}
    </div>
  );
}

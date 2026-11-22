import { Link } from "wouter";

export default function Forbidden() {
  return (
    <div className="min-h-screen bg-black text-white flex items-center justify-center p-6">
      <div className="max-w-sm text-center space-y-3">
        <h1 className="text-xl font-semibold">No permission</h1>
        <p className="text-sm text-zinc-400">Your role cannot open this page.</p>
        <Link href="/" className="inline-block rounded-lg bg-white text-black px-4 py-2 text-sm font-medium">
          Back home
        </Link>
      </div>
    </div>
  );
}

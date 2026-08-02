import { SignIn } from "@clerk/nextjs";

export default function SignInPage() {
  return <main className="centered-page"><section className="access-card sign-in-card"><span className="eyebrow">Authorized access only</span><h1>Aterra Financial Control Room</h1><p>Sign in with your invited Google account or authorized email address.</p><SignIn routing="path" path="/sign-in" /></section></main>;
}

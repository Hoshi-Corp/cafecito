import { SignInLink } from "@/components/Entry";

// A personal link keeps its token after the #, which browsers never send to the server (so it stays out of logs).
export default function SignIn() {
  return <SignInLink />;
}

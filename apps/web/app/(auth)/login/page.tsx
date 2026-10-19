import { LoginForm } from "@/components/auth/AuthForms";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return <div className="auth"><LoginForm next={next?.startsWith("/") ? next : "/"} /></div>;
}

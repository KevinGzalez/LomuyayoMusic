'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function LoginForm() {
  const router = useRouter(); const [error,setError]=useState(''); const [loading,setLoading]=useState(false);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setLoading(true); setError(''); const form=new FormData(event.currentTarget);
    const response=await fetch('/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:form.get('username'),password:form.get('password')})});
    const result=await response.json(); setLoading(false); if(!response.ok) return setError(result.error); router.replace('/dashboard'); router.refresh();
  }
  return <form onSubmit={submit} className="login-form"><label>Username<input name="username" autoComplete="username" required /></label><label>Password<input name="password" type="password" autoComplete="current-password" required /></label>{error&&<p className="form-error">{error}</p>}<button disabled={loading}>{loading?'Entrando…':'Login'}</button></form>;
}

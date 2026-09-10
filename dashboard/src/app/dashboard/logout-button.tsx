'use client';
import { LogOut } from 'lucide-react';
import { useRouter } from 'next/navigation';
export function LogoutButton(){const router=useRouter();return <button className="icon-button" title="Cerrar sesión" onClick={async()=>{await fetch('/api/auth/logout',{method:'POST'});router.replace('/login');router.refresh();}}><LogOut size={17}/></button>}

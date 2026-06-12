import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { LogOut, Menu, X } from 'lucide-react';
import { useState } from 'react';

export default function AppShell({ children }: { children: React.ReactNode }) {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-50 border-b bg-card/80 backdrop-blur-md">
        <div className="container flex h-14 items-center justify-between">
          <Link to="/dashboard" className="flex items-center gap-2 font-semibold text-foreground">
            <img src="/roomshare.png" alt="RoomShare" className="h-7 w-7" />
            <span className="hidden sm:inline">RoomShare</span>
          </Link>

          <div className="hidden md:flex items-center gap-3">
            <span className="text-sm text-muted-foreground">{user?.email}</span>
            <Button variant="ghost" size="sm" onClick={() => { signOut(); navigate('/'); }}>
              <LogOut className="h-4 w-4" />
            </Button>
          </div>

          <button className="md:hidden p-2" onClick={() => setMenuOpen(!menuOpen)}>
            {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>

        {menuOpen && (
          <div className="md:hidden border-t bg-card p-4 space-y-3 animate-fade-in">
            <Link to="/dashboard" className="block text-sm py-2" onClick={() => setMenuOpen(false)}>Dashboard</Link>
            <button className="text-sm py-2 text-destructive" onClick={() => { signOut(); navigate('/'); }}>Sign Out</button>
          </div>
        )}
      </header>
      <main>{children}</main>
    </div>
  );
}

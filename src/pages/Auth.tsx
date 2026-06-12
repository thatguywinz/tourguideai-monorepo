import { useState } from 'react';
import { useNavigate, Navigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';

export default function Auth() {
  const { user, loading, signIn, signUp } = useAuth();
  const navigate = useNavigate();
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (loading) return null;
  if (user) return <Navigate to="/dashboard" replace />;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    const { error } = isSignUp ? await signUp(email, password) : await signIn(email, password);
    setSubmitting(false);
    if (error) {
      toast.error(error.message);
    } else if (isSignUp) {
      toast.success('Check your email to confirm your account');
    } else {
      navigate('/dashboard');
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm space-y-8 animate-fade-in-up">
        <div className="text-center">
          <div className="flex items-center justify-center gap-2 mb-4">
            <img src="/roomshare.png" alt="RoomShare" className="h-8 w-8" />
            <span className="text-xl font-semibold">RoomShare</span>
          </div>
          <h1 className="text-2xl font-bold">{isSignUp ? 'Create account' : 'Welcome back'}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {isSignUp ? 'Start creating 3D room tours' : 'Sign in to your account'}
          </p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <Input type="email" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} required />
          <Input type="password" placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} required minLength={6} />
          <Button type="submit" className="w-full" disabled={submitting}>
            {submitting ? 'Please wait…' : isSignUp ? 'Sign Up' : 'Sign In'}
          </Button>
        </form>
        <p className="text-center text-sm text-muted-foreground">
          {isSignUp ? 'Already have an account?' : "Don't have an account?"}{' '}
          <button className="text-accent font-medium hover:underline" onClick={() => setIsSignUp(!isSignUp)}>
            {isSignUp ? 'Sign In' : 'Sign Up'}
          </button>
        </p>
      </div>
    </div>
  );
}

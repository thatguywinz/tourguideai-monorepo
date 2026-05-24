import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import {
  Home, Camera, Eye, Share2, CheckCircle2, ArrowRight,
  Smartphone, Box, Globe2, Layers, Cpu, Maximize2,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';

export default function Landing() {
  const { user } = useAuth();

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="container flex h-16 items-center justify-between">
        <div className="flex items-center gap-2 font-semibold">
          <Box className="h-5 w-5 text-accent" />
          <span>TourGuide AI</span>
        </div>
        <Link to={user ? '/dashboard' : '/auth'}>
          <Button variant="outline" size="sm">{user ? 'Dashboard' : 'Sign In'}</Button>
        </Link>
      </header>

      {/* Hero */}
      <section className="container max-w-5xl py-20 md:py-32">
        <div className="text-center animate-fade-in-up max-w-3xl mx-auto">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-accent/10 text-accent text-sm font-medium mb-6">
            <Cpu className="h-3.5 w-3.5" /> Powered by 3D Reconstruction AI
          </div>
          <h1 className="text-4xl md:text-6xl font-bold tracking-tight leading-tight">
            Real 3D home tours
            <br />
            <span className="text-gradient">from your phone</span>
          </h1>
          <p className="mt-6 text-lg text-muted-foreground max-w-xl mx-auto">
            Capture photos or video of any room, and our AI builds a real 3D model you can explore, rotate, and share — not a slideshow, not a panorama.
          </p>
          <div className="mt-8 flex justify-center gap-3">
            <Link to={user ? '/dashboard' : '/auth'}>
              <Button size="lg" variant="hero">
                Get Started Free <ArrowRight className="h-4 w-4 ml-2" />
              </Button>
            </Link>
          </div>
          <div className="mt-6 flex items-center justify-center gap-6 text-sm text-muted-foreground">
            <span className="flex items-center gap-1"><CheckCircle2 className="h-4 w-4 text-accent" /> Free to use</span>
            <span className="flex items-center gap-1"><CheckCircle2 className="h-4 w-4 text-accent" /> No equipment</span>
            <span className="flex items-center gap-1"><CheckCircle2 className="h-4 w-4 text-accent" /> Real 3D models</span>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="border-t bg-muted/30 py-20 md:py-24">
        <div className="container max-w-4xl">
          <div className="text-center mb-14 animate-fade-in-up">
            <p className="text-sm font-medium text-accent tracking-wide uppercase mb-2">How It Works</p>
            <h2 className="text-3xl md:text-4xl font-bold">From phone photos to 3D tour</h2>
            <p className="mt-3 text-muted-foreground max-w-lg mx-auto">
              No special cameras. No professionals. Just your phone and a few minutes.
            </p>
          </div>
          <div className="grid md:grid-cols-4 gap-6">
            {[
              { icon: Camera, title: 'Capture', desc: 'Take 20–60 overlapping photos or a short video of each room.', step: '01' },
              { icon: Cpu, title: 'Process', desc: 'Our AI reconstructs a real 3D model from your captures.', step: '02' },
              { icon: Eye, title: 'Explore', desc: 'Rotate, zoom, and walk through each room in full 3D.', step: '03' },
              { icon: Share2, title: 'Share', desc: 'Publish your tour and share a link with anyone.', step: '04' },
            ].map(({ icon: Icon, title, desc, step }, i) => (
              <div key={title} className={`relative p-6 rounded-2xl bg-card border shadow-sm animate-fade-in-up stagger-${i + 1}`}>
                <span className="text-5xl font-bold text-muted/60 absolute top-4 right-4">{step}</span>
                <div className="w-12 h-12 rounded-xl bg-accent/10 flex items-center justify-center mb-4">
                  <Icon className="h-6 w-6 text-accent" />
                </div>
                <h3 className="font-semibold text-lg mb-2">{title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="py-20 md:py-24">
        <div className="container max-w-4xl">
          <div className="text-center mb-14 animate-fade-in-up">
            <p className="text-sm font-medium text-accent tracking-wide uppercase mb-2">Features</p>
            <h2 className="text-3xl md:text-4xl font-bold">Built for real estate professionals</h2>
          </div>
          <div className="grid sm:grid-cols-2 gap-6">
            {[
              { icon: Box, title: 'True 3D reconstruction', desc: 'Not panoramas — real 3D models built from your photos using AI reconstruction.' },
              { icon: Smartphone, title: 'Phone-first capture', desc: 'Designed for phones. Take photos or video — no special equipment needed.' },
              { icon: Maximize2, title: 'Interactive 3D viewer', desc: 'Rotate, zoom, and explore rooms in full WebGL 3D with smooth controls.' },
              { icon: Globe2, title: 'One-click publishing', desc: 'Generate a shareable link instantly. Anyone can view your 3D tour.' },
              { icon: Layers, title: 'Multi-room tours', desc: 'Link all rooms into one seamless tour with room-by-room navigation.' },
              { icon: Cpu, title: 'AI processing pipeline', desc: 'Camera estimation, mesh building, and scene optimization — all automated.' },
            ].map(({ icon: Icon, title, desc }, i) => (
              <div key={title} className={`flex gap-4 p-5 rounded-xl border bg-card animate-fade-in-up stagger-${i + 1}`}>
                <div className="w-10 h-10 rounded-lg bg-accent/10 flex items-center justify-center flex-shrink-0">
                  <Icon className="h-5 w-5 text-accent" />
                </div>
                <div>
                  <h3 className="font-semibold mb-1">{title}</h3>
                  <p className="text-sm text-muted-foreground">{desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="border-t bg-primary py-16 md:py-20">
        <div className="container max-w-2xl text-center animate-fade-in-up">
          <h2 className="text-3xl md:text-4xl font-bold text-primary-foreground">Ready to create your first 3D tour?</h2>
          <p className="mt-4 text-primary-foreground/70">
            Capture your property in minutes. No special equipment required.
          </p>
          <Link to={user ? '/dashboard' : '/auth'} className="inline-block mt-8">
            <Button size="lg" variant="secondary">
              Start Building <ArrowRight className="h-4 w-4 ml-2" />
            </Button>
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t py-8">
        <div className="container text-center text-sm text-muted-foreground">
          © {new Date().getFullYear()} TourGuide AI
        </div>
      </footer>
    </div>
  );
}

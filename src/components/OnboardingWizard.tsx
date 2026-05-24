import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Camera, MousePointerClick, Share2, ArrowRight, Home, CheckCircle2 } from 'lucide-react';

const steps = [
  {
    icon: Home,
    title: 'Welcome to TourGuide AI',
    description: 'Create immersive virtual home tours using just your phone. No expensive cameras or professional equipment needed.',
    tip: 'Perfect for real estate agents, homeowners, and property managers.',
  },
  {
    icon: Camera,
    title: 'Capture rooms',
    description: 'Stand in the center of each room and take a panoramic photo. You can use your phone\'s built-in panorama mode or upload existing 360° images.',
    tip: 'Tip: Natural lighting works best. Open curtains and turn on lights for the best results.',
  },
  {
    icon: MousePointerClick,
    title: 'Link rooms together',
    description: 'Place clickable hotspots on your panoramas to connect rooms. Click where a door or hallway is, then select which room it leads to.',
    tip: 'This creates a seamless walkthrough experience for your viewers.',
  },
  {
    icon: Share2,
    title: 'Publish & share',
    description: 'When you\'re happy with your tour, hit Publish. You\'ll get a unique link that anyone can open — no login required.',
    tip: 'Share it via email, text, or social media.',
  },
];

export default function OnboardingWizard({ onComplete }: { onComplete: () => void }) {
  const [step, setStep] = useState(0);
  const current = steps[step];
  const isLast = step === steps.length - 1;
  const Icon = current.icon;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/60 backdrop-blur-sm p-4">
      <div className="bg-card rounded-2xl border shadow-2xl w-full max-w-md overflow-hidden animate-scale-in">
        {/* Progress */}
        <div className="flex gap-1 px-6 pt-6">
          {steps.map((_, i) => (
            <div
              key={i}
              className={`h-1 flex-1 rounded-full transition-colors ${i <= step ? 'bg-accent' : 'bg-muted'}`}
            />
          ))}
        </div>

        {/* Content */}
        <div className="p-6 pt-8 text-center">
          <div className="w-16 h-16 rounded-2xl bg-accent/10 flex items-center justify-center mx-auto mb-6">
            <Icon className="h-8 w-8 text-accent" />
          </div>
          <h2 className="text-xl font-bold mb-3">{current.title}</h2>
          <p className="text-muted-foreground text-sm leading-relaxed mb-4">{current.description}</p>
          <div className="flex items-start gap-2 text-left bg-muted/50 rounded-lg p-3">
            <CheckCircle2 className="h-4 w-4 text-accent mt-0.5 flex-shrink-0" />
            <p className="text-xs text-muted-foreground">{current.tip}</p>
          </div>
        </div>

        {/* Actions */}
        <div className="px-6 pb-6 flex gap-3">
          {step > 0 && (
            <Button variant="outline" className="flex-1" onClick={() => setStep(step - 1)}>
              Back
            </Button>
          )}
          {!isLast ? (
            <Button className="flex-1" onClick={() => setStep(step + 1)}>
              Next <ArrowRight className="h-4 w-4 ml-1" />
            </Button>
          ) : (
            <Button className="flex-1" onClick={onComplete}>
              Create My First Tour <ArrowRight className="h-4 w-4 ml-1" />
            </Button>
          )}
        </div>

        {!isLast && (
          <div className="px-6 pb-4 text-center">
            <button className="text-xs text-muted-foreground hover:text-foreground transition-colors" onClick={onComplete}>
              Skip intro
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

import { useState } from 'react';
import { DashboardSidebar } from './DashboardSidebar';
import { useIsMobile } from '@/hooks/use-mobile';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Menu } from 'lucide-react';

interface DashboardLayoutProps {
  children: React.ReactNode;
  className?: string;
  badgeCounts?: { all?: number; active?: number };
  /** Hide the mobile hamburger (e.g. Dashboard inbox manages its own) */
  hideMobileMenu?: boolean;
}

export const DashboardLayout = ({ children, className, badgeCounts, hideMobileMenu }: DashboardLayoutProps) => {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const isMobile = useIsMobile();

  return (
    <div className={cn("flex h-screen overflow-hidden", className || "bg-sidebar")}>
      <DashboardSidebar
        badgeCounts={badgeCounts}
        mobileOpen={sidebarOpen}
        onMobileOpenChange={setSidebarOpen}
      />
      <DashboardLayoutContext.Provider value={{ openSidebar: () => setSidebarOpen(true), isMobile: !!isMobile }}>
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          {children}
        </div>
      </DashboardLayoutContext.Provider>
    </div>
  );
};

// Context so PageHeader can access the sidebar trigger
import { createContext, useContext } from 'react';

interface DashboardLayoutContextType {
  openSidebar: () => void;
  isMobile: boolean;
}

const DashboardLayoutContext = createContext<DashboardLayoutContextType>({
  openSidebar: () => {},
  isMobile: false,
});

export const useDashboardLayout = () => useContext(DashboardLayoutContext);

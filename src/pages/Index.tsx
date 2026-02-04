import { useState, useEffect } from 'react';
import { EnhancedAppProvider } from '@/contexts/EnhancedAppContext';
import { Sidebar } from '@/components/Sidebar';
import { EnhancedDashboard } from '@/components/EnhancedDashboard';
import { ProjectsPage } from '@/components/ProjectsPage';
import { EnhancedUsersPage } from '@/components/EnhancedUsersPage';
import { EnhancedCampaignsPage as CampaignsPage } from '@/components/EnhancedCampaignsPage';
import { TemplatesPage } from '@/components/TemplatesPage';
import { ProfileManager } from '@/components/ProfileManager';
import { AppManagement } from '@/components/AppManagement';
import { AIManagement } from '@/components/AIManagement';
import { TestCampaign } from '@/components/TestCampaign';
import { useEnhancedApp } from '@/contexts/EnhancedAppContext';
import { Toaster } from '@/components/ui/toaster';
import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AuditLogsPage } from '@/components/AuditLogsPage';

const AppContent = () => {
  const [currentPage, setCurrentPage] = useState('dashboard');
  const { 
    profiles, 
    activeProfile, 
    setActiveProfile, 
    addProfile, 
    removeProfile,
    projects,
    users,
    campaigns
  } = useEnhancedApp();

  // Auto-select first profile if none selected
  useEffect(() => {
    if (!activeProfile && profiles.length > 0) {
      setActiveProfile(profiles[0].id);
    }
  }, [profiles, activeProfile, setActiveProfile]);

  // Removed re-sync of all projects on load to prevent heavy startup load

  const renderPage = () => {
    switch (currentPage) {
      case 'dashboard':
        return <EnhancedDashboard />;
      case 'projects':
        return <ProjectsPage />;
      case 'users':
        return <EnhancedUsersPage />;
      case 'campaigns':
        return <CampaignsPage />;
      case 'templates':
        return <TemplatesPage />;
      case 'profiles':
        return <ProfileManager />;
      case 'ai':
        return <AIManagement />;
      case 'test':
        return <TestCampaign />;
      case 'audit-logs':
        return <AuditLogsPage />;
      case 'settings':
        return <AppManagement />;
      default:
        return <EnhancedDashboard />;
    }
  };

  return (
    <div className="flex h-screen bg-gray-900">
      <Sidebar 
        currentPage={currentPage} 
        setCurrentPage={setCurrentPage}
        profiles={profiles}
        activeProfile={activeProfile}
        onProfileChange={setActiveProfile}
        onAddProfile={addProfile}
        onRemoveProfile={removeProfile}
        projectCounts={profiles.reduce((acc, profile) => {
          acc[profile.id] = projects.filter(p => p.profileId === profile.id).length;
          return acc;
        }, {} as { [profileId: string]: number })}
      />
      <main className="flex-1 overflow-auto">
        {renderPage()}
      </main>
      <Toaster />
    </div>
  );
};

class ErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean; error: any }> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error: any) {
    return { hasError: true, error };
  }
  componentDidCatch(error: any, info: ErrorInfo) {
    console.error('ErrorBoundary caught an error:', error, info);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ color: 'red', padding: 32 }}>
          <h1>Something went wrong.</h1>
          <pre>{this.state.error?.toString()}</pre>
        </div>
      );
    }
    return this.props.children;
  }
}

const Index = () => {
  return (
    <EnhancedAppProvider>
      <ErrorBoundary>
        <AppContent />
      </ErrorBoundary>
    </EnhancedAppProvider>
  );
};

export default Index;

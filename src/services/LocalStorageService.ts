export interface Profile {
  id: string;
  name: string;
  description?: string;
  createdAt: string;
  projectIds: string[];
  ownerId: string; // Username of the owner
}

export interface StoredProject {
  id: string;
  name: string;
  adminEmail: string;
  apiKey: string;
  serviceAccount: any;
  status: 'loading' | 'active' | 'error';
  createdAt: string;
  profileId?: string;
  ownerId: string; // Username of the owner
}

export interface LocalData {
  profiles: Profile[];
  projects: StoredProject[];
  activeProfile?: string;
}

class LocalStorageService {
  private readonly STORAGE_KEY = 'firebase-campaign-data';

  // Load data from localStorage
  loadData(): LocalData {
    try {
      const stored = localStorage.getItem(this.STORAGE_KEY);
      if (stored) {
        return JSON.parse(stored);
      }
    } catch (error) {
      console.error('Failed to load local data:', error);
    }
    
    return {
      profiles: [],
      projects: [],
    };
  }

  // Save data to localStorage
  saveData(data: LocalData): void {
    try {
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(data));
    } catch (error) {
      console.error('Failed to save local data:', error);
    }
  }

  // Export data as JSON file
  exportData(): void {
    const data = this.loadData();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `firebase-campaign-backup-${new Date().toISOString().split('T')[0]}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  // Import data from JSON file
  async importData(file: File): Promise<LocalData> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = JSON.parse(e.target?.result as string);
          this.saveData(data);
          resolve(data);
        } catch (error) {
          reject(error);
        }
      };
      reader.onerror = reject;
      reader.readAsText(file);
    });
  }
}

export const localStorageService = new LocalStorageService();

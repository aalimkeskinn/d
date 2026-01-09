import { Outlet, useLocation } from 'react-router-dom';
import Sidebar from './Sidebar';
import NavigationProgress from '../UI/NavigationProgress';

const Layout = () => {
  const location = useLocation();

  return (
    <div className="flex h-screen bg-gray-50">
      {/* Global Navigation Progress Bar */}
      <NavigationProgress />

      <Sidebar />
      <main className="flex-1 overflow-auto lg:ml-0 overflow-x-hidden">
        {/* FIXED: Normal content spacing - no special mobile adjustments */}
        <div
          key={location.pathname}
          className="pt-20 lg:pt-0 animate-in fade-in slide-in-from-bottom-4 duration-300"
        >
          <Outlet />
        </div>
      </main>
    </div>
  );
};

export default Layout;
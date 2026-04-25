import { useEffect, useState } from 'react';
import api from '../lib/axios';

export default function TopAlerts() {
  const [warnings, setWarnings] = useState([]);

  useEffect(() => {
    const fetchWarnings = async () => {
      try {
        const res = await api.get('/permits/warnings');
        if (Array.isArray(res.data)) {
          setWarnings(res.data);
        }
      } catch {
        // failed to fetch, possibly unauthenticated, ignore silently
      }
    };
    
    fetchWarnings();
    const interval = setInterval(fetchWarnings, 30000); // 30 seconds polling
    return () => clearInterval(interval);
  }, []);

  if (!warnings || warnings.length === 0) return null;

  return (
    <div className="bg-destructive text-destructive-foreground px-4 py-2 flex items-center shadow-lg font-medium sticky top-0 z-50">
      <span className="w-5 h-5 mr-3 animate-pulse shrink-0 font-bold bg-white/20 text-center rounded-full">!</span>
      <div className="flex-1 overflow-hidden">
        <div className="animate-marquee whitespace-nowrap">
          {warnings.map((w, idx) => (
             <span key={w.permit_id || idx} className="mr-8">
               <span className="font-bold">【{w.status === 'expired' ? '已超期' : '即将超期'}】</span>
               作业票 #{w.permit_id} - 区域: {w.area_name || w.area_id} - 责任人: {w.responsible_person} - 截止: {new Date(w.end_time).toLocaleString()}
             </span>
          ))}
        </div>
      </div>
    </div>
  );
}

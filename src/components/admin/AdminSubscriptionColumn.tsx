import { useState, useEffect } from 'react';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface Props {
  userId: string;
}

export function AdminSubscriptionColumn({ userId }: Props) {
  const [sub, setSub] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    const fetchSub = async () => {
      const { data } = await supabase
        .from('subscriptions')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle();
      setSub(data);
      setLoading(false);
    };
    fetchSub();
  }, [userId]);

  const handleCompToggle = async (checked: boolean) => {
    setToggling(true);
    const updates = checked
      ? { is_comped: true, status: 'comped' }
      : { is_comped: false, status: 'trialing' };

    const { error } = await supabase
      .from('subscriptions')
      .update(updates)
      .eq('user_id', userId);

    if (error) {
      toast({ title: 'Error', description: 'Failed to update comp status', variant: 'destructive' });
    } else {
      setSub((prev: any) => prev ? { ...prev, ...updates } : prev);
      toast({ title: 'Success', description: checked ? 'Account comped' : 'Comp removed' });
    }
    setToggling(false);
  };

  if (loading) return <span className="text-xs text-muted-foreground">...</span>;
  if (!sub) return <span className="text-xs text-muted-foreground">No sub</span>;

  const statusLabel = sub.is_comped ? 'Comped' : sub.status;
  const variant = sub.is_comped || sub.status === 'active' ? 'default'
    : sub.status === 'trialing' ? 'secondary'
    : 'outline';

  return (
    <div className="flex items-center gap-2">
      <Badge variant={variant} className="text-xs capitalize">{statusLabel}</Badge>
      <div className="flex items-center gap-1" title="Comp account (free access)">
        <Switch
          checked={sub.is_comped}
          onCheckedChange={handleCompToggle}
          disabled={toggling}
          className="scale-75"
        />
        <span className="text-[10px] text-muted-foreground">Comp</span>
      </div>
    </div>
  );
}

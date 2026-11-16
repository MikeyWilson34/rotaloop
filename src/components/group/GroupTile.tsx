import { Users } from 'lucide-react-native';
import { View } from 'react-native';

import { accentFor } from '@/lib/groupViews';
import { useTheme } from '@/theme';

/** The Group's tinted icon tile (prototype `.gtile`): 44px, or 56px in the Group header. */
export function GroupTile({ groupId, size = 44 }: { groupId: string; size?: number }) {
  const { groupAccents } = useTheme();
  const accent = groupAccents[accentFor(groupId)];
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: Math.round(size * 0.29),
        backgroundColor: accent.tile,
        alignItems: 'center',
        justifyContent: 'center',
      }}>
      <Users size={Math.round(size * 0.5)} color={accent.icon} strokeWidth={1.75} />
    </View>
  );
}

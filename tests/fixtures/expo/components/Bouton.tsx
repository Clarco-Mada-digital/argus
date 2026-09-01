import { Pressable, Text } from 'react-native';

export function Bouton({ titre, onPress }: { titre: string; onPress: () => void }) {
  return <Pressable onPress={onPress}><Text>{titre}</Text></Pressable>;
}

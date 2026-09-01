import AsyncStorage from '@react-native-async-storage/async-storage';
import { Text, View } from 'react-native';

export default function Profil() {
  const enregistrer = async (jeton: string) => {
    await AsyncStorage.setItem('auth_token', jeton);
  };
  return <View><Text>Profil</Text></View>;
}

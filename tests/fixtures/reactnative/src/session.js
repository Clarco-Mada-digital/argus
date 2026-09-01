import AsyncStorage from '@react-native-async-storage/async-storage';

export async function enregistrerSession(reponse) {
  await AsyncStorage.setItem('auth_token', reponse.jeton);
  await AsyncStorage.setItem('refresh_token', reponse.rafraichissement);
}

export async function lireSession() {
  return AsyncStorage.getItem('auth_token');
}

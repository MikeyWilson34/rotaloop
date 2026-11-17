// Deep imports: the package index references all 18 Nunito Sans files, which the web export
// would ship as assets. Only the four weights of the type scale are bundled.
import { NunitoSans_400Regular } from '@expo-google-fonts/nunito-sans/400Regular';
import { NunitoSans_600SemiBold } from '@expo-google-fonts/nunito-sans/600SemiBold';
import { NunitoSans_700Bold } from '@expo-google-fonts/nunito-sans/700Bold';
import { NunitoSans_800ExtraBold } from '@expo-google-fonts/nunito-sans/800ExtraBold';
import { useFonts } from 'expo-font';

/** Loads the Nunito Sans weights used by the type scale. Returns [loaded, error]. */
export function useAppFonts() {
  return useFonts({
    NunitoSans_400Regular,
    NunitoSans_600SemiBold,
    NunitoSans_700Bold,
    NunitoSans_800ExtraBold,
  });
}

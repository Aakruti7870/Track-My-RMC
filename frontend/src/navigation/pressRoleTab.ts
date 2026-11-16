import { CommonActions } from "@react-navigation/native";

export type RoleTabRoute = { key: string; name: string; params?: object };
export type RoleTabState = { key: string; index: number; routes: RoleTabRoute[] };
export type RoleTabNavigation = {
  emit: (event: { type: "tabPress"; target: string; canPreventDefault: true }) => { defaultPrevented: boolean };
  dispatch: (action: ReturnType<typeof CommonActions.navigate>) => void;
};

/** Keep tab presses inside the owning navigator, including tabs with shared route names. */
export function pressRoleTab(state: RoleTabState, navigation: RoleTabNavigation, route: RoleTabRoute) {
  const event = navigation.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
  if (!event.defaultPrevented && state.routes[state.index]?.key !== route.key) {
    navigation.dispatch({ ...CommonActions.navigate(route.name, route.params), target: state.key });
  }
}

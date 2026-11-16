import Head from "expo-router/head";
import LoginScreen from "@/src/screens/LoginScreen";

export default function Login() {
  return <>
    <Head>
      <title>TrackMyRMC | Ready-Mix Concrete Ordering and Delivery</title>
      <meta name="description" content="Find ready-mix concrete plants, request a quotation, place an order and track your concrete delivery with TrackMyRMC." />
      <link rel="canonical" href="https://trackmyrmc.com/login" />
    </Head>
    <LoginScreen />
  </>;
}

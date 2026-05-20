import { redirect } from "next/navigation";

export default function ClubPage() {
    redirect("/clients?tab=club");
}

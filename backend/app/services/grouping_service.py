from collections import defaultdict


class GroupingService:
    def create_groups(
        self,
        student_skill_mastery: dict[str, dict[str, float]],
        skill_lookup: dict[str, dict],
    ) -> list[dict]:
        dominant_groups: dict[str, list[str]] = defaultdict(list)

        for student_id, mastery_by_skill in student_skill_mastery.items():
            weak_skills = [
                (skill_id, mastery)
                for skill_id, mastery in mastery_by_skill.items()
                if mastery < 0.6 and skill_id in skill_lookup
            ]
            if not weak_skills:
                continue
            weak_skills.sort(key=lambda item: item[1])
            dominant_skill = weak_skills[0][0]
            dominant_groups[dominant_skill].append(student_id)

        groups: list[dict] = []
        for skill_id, members in dominant_groups.items():
            for idx in range(0, len(members), 8):
                chunk = members[idx : idx + 8]
                groups.append(
                    {
                        "skill_id": skill_id,
                        "skill_name": skill_lookup[skill_id]["name"],
                        "student_ids": chunk,
                        "recommended_activity": f"10-minute mini-lesson on {skill_lookup[skill_id]['name']} then 5 targeted questions.",
                    }
                )

        if not groups:
            return []

        # Merge very small groups into nearest parent-skill group when possible.
        large_groups = [g for g in groups if len(g["student_ids"]) >= 4]
        small_groups = [g for g in groups if len(g["student_ids"]) < 4]
        if large_groups:
            for group in small_groups:
                parent_id = skill_lookup[group["skill_id"]].get("parent_skill_id")
                target = None
                if parent_id:
                    target = next((g for g in large_groups if g["skill_id"] == parent_id), None)
                if not target:
                    target = min(large_groups, key=lambda g: len(g["student_ids"]))
                target["student_ids"].extend(group["student_ids"])
            groups = large_groups

        # Keep 2..5 groups by merging smallest groups when over 5.
        while len(groups) > 5:
            groups = sorted(groups, key=lambda g: len(g["student_ids"]))
            g1 = groups.pop(0)
            g2 = groups.pop(0)
            merged = {
                "skill_id": g1["skill_id"],
                "skill_name": g1["skill_name"],
                "student_ids": g1["student_ids"] + g2["student_ids"],
                "recommended_activity": g1["recommended_activity"],
            }
            groups.append(merged)

        if len(groups) == 1:
            only = groups[0]
            mid = max(1, len(only["student_ids"]) // 2)
            groups = [
                {**only, "student_ids": only["student_ids"][:mid]},
                {**only, "student_ids": only["student_ids"][mid:]},
            ]

        return groups

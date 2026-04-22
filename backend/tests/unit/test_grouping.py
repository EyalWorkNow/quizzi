from app.services.grouping_service import GroupingService


def test_grouping_creates_support_groups() -> None:
    service = GroupingService()
    student_mastery = {
        "stu1": {"s1": 0.2, "s2": 0.7},
        "stu2": {"s1": 0.3, "s2": 0.8},
        "stu3": {"s1": 0.4, "s2": 0.6},
        "stu4": {"s2": 0.3},
        "stu5": {"s2": 0.2},
    }
    skill_lookup = {
        "s1": {"name": "Fractions", "parent_skill_id": None},
        "s2": {"name": "Ratios", "parent_skill_id": None},
    }

    groups = service.create_groups(student_mastery, skill_lookup)
    assert len(groups) >= 1
    assert all("student_ids" in group for group in groups)

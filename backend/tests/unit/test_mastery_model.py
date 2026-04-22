from app.services.diagnostics_service import MasteryUpdater


def test_mastery_update_bounds_and_direction() -> None:
    updater = MasteryUpdater()
    after_correct = updater.apply(0.5, "medium", True)
    after_wrong = updater.apply(0.5, "medium", False)

    assert 0.5 < after_correct <= 1.0
    assert 0.0 <= after_wrong < 0.5

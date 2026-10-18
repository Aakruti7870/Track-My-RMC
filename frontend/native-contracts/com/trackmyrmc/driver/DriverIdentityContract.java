package com.trackmyrmc.driver;

import java.time.LocalDate;
import java.util.Locale;
import java.util.Objects;
import java.util.Set;

/**
 * Android-native companion contract for the TrackMyRMC driver card.
 * The production Expo Android/Web app uses the Rust API + React Native;
 * this immutable Java contract is intentionally not a replacement for that UI.
 */
public final class DriverIdentityContract {
    private static final Set<String> BLOOD_GROUPS =
            Set.of("A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-");
    private final String employeeId;
    private final LocalDate companyJoiningDate;
    private final Integer totalDrivingExperienceMonths;
    private final String bloodGroup;

    public DriverIdentityContract(
            String employeeId, LocalDate companyJoiningDate,
            Integer totalDrivingExperienceMonths, String bloodGroup) {
        String id = employeeId == null ? null : employeeId.trim().toUpperCase(Locale.ROOT);
        if (id != null && !id.isEmpty() && !id.matches("[A-Z0-9_-]{2,50}")) {
            throw new IllegalArgumentException("Invalid employee ID");
        }
        if (companyJoiningDate != null && companyJoiningDate.isAfter(LocalDate.now())) {
            throw new IllegalArgumentException("Joining date cannot be in the future");
        }
        if (totalDrivingExperienceMonths != null &&
                (totalDrivingExperienceMonths < 0 || totalDrivingExperienceMonths > 960)) {
            throw new IllegalArgumentException("Driving experience must be 0 to 960 months");
        }
        if (bloodGroup != null && !BLOOD_GROUPS.contains(bloodGroup)) {
            throw new IllegalArgumentException("Invalid blood group");
        }
        this.employeeId = id == null || id.isEmpty() ? null : id;
        this.companyJoiningDate = companyJoiningDate;
        this.totalDrivingExperienceMonths = totalDrivingExperienceMonths;
        this.bloodGroup = bloodGroup;
    }

    public String employeeId() { return employeeId; }
    public LocalDate companyJoiningDate() { return companyJoiningDate; }
    public Integer totalDrivingExperienceMonths() { return totalDrivingExperienceMonths; }
    public String bloodGroup() { return bloodGroup; }

    public String experienceDisplay() {
        Integer value = totalDrivingExperienceMonths;
        if (value == null) return "Not provided";
        int years = value / 12;
        int months = value % 12;
        if (years == 0) return months + (months == 1 ? " Month" : " Months");
        String yearsPart = years + (years == 1 ? " Year" : " Years");
        return months == 0 ? yearsPart
                : yearsPart + " " + months + (months == 1 ? " Month" : " Months");
    }

    @Override public boolean equals(Object other) {
        if (!(other instanceof DriverIdentityContract)) return false;
        DriverIdentityContract that = (DriverIdentityContract) other;
        return Objects.equals(employeeId, that.employeeId)
                && Objects.equals(companyJoiningDate, that.companyJoiningDate)
                && Objects.equals(totalDrivingExperienceMonths, that.totalDrivingExperienceMonths)
                && Objects.equals(bloodGroup, that.bloodGroup);
    }
    @Override public int hashCode() {
        return Objects.hash(employeeId, companyJoiningDate, totalDrivingExperienceMonths, bloodGroup);
    }
}

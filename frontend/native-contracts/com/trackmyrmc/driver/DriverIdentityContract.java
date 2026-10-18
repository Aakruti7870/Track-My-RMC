package com.trackmyrmc.driver;

import java.time.LocalDate;
import java.util.Locale;
import java.util.Objects;
import java.util.Set;

/**
 * Android-native companion for the nine-field TrackMyRMC Driver Card.
 * The production Expo Android/Web app uses the existing Rust API + React Native.
 */
public final class DriverIdentityContract {
    private static final Set<String> BLOOD_GROUPS =
            Set.of("A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-");

    public record EmergencyContact(String name, String phone) {
        public EmergencyContact {
            if (name != null && name.length() > 120)
                throw new IllegalArgumentException("Emergency name too long");
            if (phone != null && !phone.matches("[+0-9 -]{10,20}"))
                throw new IllegalArgumentException("Invalid emergency contact phone");
        }

        public String display() {
            String result = (name == null || name.isBlank()) ? "" : name.trim();
            if (phone != null && !phone.isBlank())
                result += (result.isEmpty() ? "" : " · ") + phone;
            return result.isEmpty() ? "Not provided" : result;
        }
    }

    private final String plantName;
    private final String tmNumber;
    private final String driverName;
    private final String bloodGroup;
    private final EmergencyContact emergencyContact1;
    private final EmergencyContact emergencyContact2;
    private final String employeeId;
    private final LocalDate companyJoiningDate;
    private final Integer totalDrivingExperienceMonths;

    /** Employment-only compatibility constructor for native integrations. */
    public DriverIdentityContract(String employeeId, LocalDate companyJoiningDate,
                                  Integer totalDrivingExperienceMonths, String bloodGroup) {
        this(null, null, null, bloodGroup, null, null,
                employeeId, companyJoiningDate, totalDrivingExperienceMonths);
    }

    public DriverIdentityContract(
            String plantName, String tmNumber, String driverName,
            String bloodGroup, EmergencyContact emergencyContact1,
            EmergencyContact emergencyContact2, String employeeId,
            LocalDate companyJoiningDate, Integer totalDrivingExperienceMonths) {
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
        this.plantName = plantName;
        this.tmNumber = tmNumber;
        this.driverName = driverName;
        this.bloodGroup = bloodGroup;
        this.emergencyContact1 = emergencyContact1;
        this.emergencyContact2 = emergencyContact2;
        this.employeeId = id == null || id.isEmpty() ? null : id;
        this.companyJoiningDate = companyJoiningDate;
        this.totalDrivingExperienceMonths = totalDrivingExperienceMonths;
    }

    public String plantName() { return plantName; }
    public String tmNumber() { return tmNumber; }
    public String driverName() { return driverName; }
    public String bloodGroup() { return bloodGroup; }
    public EmergencyContact emergencyContact1() { return emergencyContact1; }
    public EmergencyContact emergencyContact2() { return emergencyContact2; }
    public String employeeId() { return employeeId; }
    public LocalDate companyJoiningDate() { return companyJoiningDate; }
    public Integer totalDrivingExperienceMonths() { return totalDrivingExperienceMonths; }

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
        if (!(other instanceof DriverIdentityContract that)) return false;
        return Objects.equals(plantName, that.plantName)
                && Objects.equals(tmNumber, that.tmNumber)
                && Objects.equals(driverName, that.driverName)
                && Objects.equals(bloodGroup, that.bloodGroup)
                && Objects.equals(emergencyContact1, that.emergencyContact1)
                && Objects.equals(emergencyContact2, that.emergencyContact2)
                && Objects.equals(employeeId, that.employeeId)
                && Objects.equals(companyJoiningDate, that.companyJoiningDate)
                && Objects.equals(totalDrivingExperienceMonths, that.totalDrivingExperienceMonths);
    }

    @Override public int hashCode() {
        return Objects.hash(plantName, tmNumber, driverName, bloodGroup,
                emergencyContact1, emergencyContact2,
                employeeId, companyJoiningDate, totalDrivingExperienceMonths);
    }
}

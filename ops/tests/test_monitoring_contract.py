"""Offline safety checks for opt-in CloudWatch alarm definition."""
from pathlib import Path
import unittest

PATH = Path(__file__).resolve().parents[1] / "monitoring" / "trackmyrmc-production-alarms.yml"

class MonitoringContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source = PATH.read_text(encoding="utf-8")

    def test_four_infrastructure_alarm_resources(self):
        self.assertEqual(self.source.count("Type: AWS::CloudWatch::Alarm"), 4)

    def test_ec2_system_and_instance_status_monitored(self):
        for metric in ("StatusCheckFailed_System", "StatusCheckFailed_Instance"):
            self.assertIn("MetricName: " + metric, self.source)

    def test_database_storage_and_cpu_monitored(self):
        self.assertIn("MetricName: FreeStorageSpace", self.source)
        self.assertIn("MetricName: CPUUtilization", self.source)
        self.assertIn("Threshold: 2147483648", self.source)

    def test_alert_delivery_cannot_be_silently_omitted(self):
        self.assertIn("AlertTopicArn:", self.source)
        self.assertEqual(self.source.count("- !Ref AlertTopicArn"), 8)

    def test_alarm_targets_are_parameterized(self):
        self.assertIn("Value: !Ref Ec2InstanceId", self.source)
        self.assertIn("Value: !Ref RdsInstanceIdentifier", self.source)

    def test_no_prod_mutation_or_iam_resources_in_template(self):
        for forbidden in ("AWS::IAM::", "AWS::RDS::DBInstance",
                          "AWS::EC2::Instance", "AWS::Lambda::Function"):
            self.assertNotIn("\n    Type: " + forbidden + "\n", self.source)

if __name__ == "__main__":
    unittest.main()
